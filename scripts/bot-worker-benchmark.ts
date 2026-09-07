/** Bounded PostgreSQL worker measurement. Uses only its own fixtures in a guarded test DB. */
import { cpus } from 'node:os'
import { assertTestDatabaseUrl } from './repo-env.mjs'
import { createPrisma } from '../backend/src/db'
import { createTenderModule } from '../backend/src/modules/tender'
import { createTenderBotRunner } from '../backend/src/modules/tender/application/bot-runner'
import { createPrismaTenderStore } from '../backend/src/modules/tender/infrastructure/prisma-tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
assertTestDatabaseUrl(databaseUrl)
const prisma = createPrisma(databaseUrl)
const humanIds: string[] = []
const tenderIds: string[] = []
const accountLifecycleSecret = 'isolated-bot-worker-benchmark'
const batches: Array<{ durationMs: number; acceptedCommands: number; failedTenders: number }> = []
const store = createPrismaTenderStore(prisma, accountLifecycleSecret)
const tender = createTenderModule({ store })
try {
  if (await prisma.tender.count({ where: { phase: { not: 'complete' } } }) !== 0) {
    throw new Error('Use a test database without active Tenders so unrelated work is never processed')
  }
  for (let index = 0; index < 50; index += 1) {
    const human = await prisma.user.create({ data: { login: `bot-load-${crypto.randomUUID()}`, passwordHash: 'test-fixture' } })
    humanIds.push(human.id)
    const created = await tender.createTender({ players: [
      { id: human.id, tiePriority: 1 },
      ...Array.from({ length: 3 }, (_, botIndex) => ({
        id: `bot-${index}-${botIndex}`, tiePriority: botIndex + 2,
        bot: { difficulty: botIndex === 1 ? 'hard' as const : 'easy' as const, strategyVersion: 'bot-v2' as const },
      })),
    ] })
    tenderIds.push(created.tenderId)
  }
  // Bound discovery to this harness even if other test fixtures appear concurrently.
  const ownedStore = { ...store, findBotTenders: async (input: Parameters<typeof store.findBotTenders>[0]) =>
    (await store.findBotTenders(input)).filter((id) => tenderIds.includes(id)) }
  const runner = createTenderBotRunner({ store: ownedStore, tender })
  const cpuStart = process.cpuUsage()
  const startedAt = performance.now()
  let peakRss = process.memoryUsage().rss
  let receipts = 0
  for (let pass = 0; pass < 100 && receipts < 150; pass += 1) {
    const batchStartedAt = performance.now()
    const result = await runner.advance({ limit: 50, timeBudgetMs: 250 })
    batches.push({ ...result, durationMs: performance.now() - batchStartedAt })
    receipts += result.acceptedCommands
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    if (result.failedTenders !== 0) throw new Error('Worker batch failed')
  }
  const commandCounts = await Promise.all(tenderIds.map((tenderId) => prisma.tenderCommand.count({ where: { tenderId } })))
  if (receipts !== 150 || commandCounts.some((count) => count !== 3)) throw new Error('Some bot slots were skipped or executed more than once')
  const cpu = process.cpuUsage(cpuStart)
  const durations = batches.map((batch) => batch.durationMs).sort((a, b) => a - b)
  console.log(JSON.stringify({
    environment: { bun: Bun.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
    fixtureTenders: 50, botsPerTender: 3, uniqueCommands: 150,
    durationMs: performance.now() - startedAt, cpuMicros: cpu.user + cpu.system, peakRss,
    batchP95Ms: durations[Math.ceil(durations.length * .95) - 1], batches,
    scope: 'Unpaced initial access-slot decisions through the real PostgreSQL runner; not a production throughput or whole-match load SLA',
  }, null, 2))
} finally {
  await prisma.tender.deleteMany({ where: { id: { in: tenderIds } } })
  await prisma.user.deleteMany({ where: { id: { in: humanIds } } })
  await prisma.$disconnect()
}
