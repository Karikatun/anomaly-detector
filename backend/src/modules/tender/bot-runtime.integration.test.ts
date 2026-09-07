import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createTenderModule } from './index'
import { createTenderBotRunner } from './application/bot-runner'
import { anonymizePrismaTenderParticipant, createPrismaTenderStore } from './infrastructure/prisma-tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const accountLifecycleSecret = 'bot-runtime-integration-test-secret'
const helperPath = new URL('./fixtures/bot-worker-process.ts', import.meta.url).pathname

type WorkerResult = {
  acceptedCommands: number
  deadlineAdvanced: boolean
  failedTenders: number
  status: 'ok'
}

async function runWorker(input: { mode: 'none' | 'exitbeforecommit' | 'exitaftercommit' | 'deadlinebeforecommit'; tenderId: string }) {
  const child = Bun.spawn([process.execPath, helperPath], {
    env: {
      ...process.env,
      BOT_WORKER_ACCOUNT_LIFECYCLE_SECRET: accountLifecycleSecret,
      BOT_WORKER_TENDER_ID: input.tenderId,
      BOT_WORKER_TEST_MODE: input.mode,
      TEST_DATABASE_URL: databaseUrl!,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]).then(([exitCode, stdout, stderr]) => ({
        exitCode,
        result: stdout.trim() ? JSON.parse(stdout) as WorkerResult : undefined,
        stderr,
      })),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          child.kill()
          reject(new Error(`Bot worker child timed out for ${input.tenderId}`))
        }, 15_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

maybeDescribe('Tender bot runtime PostgreSQL recovery', () => {
  if (!databaseUrl) return
  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    await prisma.tender.deleteMany()
    await prisma.user.deleteMany()
  })
  afterEach(async () => {
    await prisma.tender.deleteMany()
    await prisma.user.deleteMany()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })

  const createHuman = (login: string) => prisma.user.create({ data: { login, passwordHash: 'hash' } })

  const createBotTender = async (botCount = 1) => {
    const human = await createHuman(`runtime-human-${crypto.randomUUID()}`)
    const tender = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    const created = await tender.createTender({
      players: [
        { id: human.id, tiePriority: 1 },
        ...Array.from({ length: botCount }, (_, index) => ({
          bot: { difficulty: 'easy' as const, strategyVersion: 'bot-v2' as const },
          id: `bot-${index + 1}`,
          tiePriority: index + 2,
        })),
      ],
    })
    return { ...created, humanId: human.id }
  }

  const countCommands = (tenderId: string) => prisma.tenderCommand.count({ where: { tenderId } })

  test('does not plan from a newer projection after account cleanup wins the availability check race', async () => {
    const { tenderId, humanId } = await createBotTender(3)
    const base = createPrismaTenderStore(prisma, accountLifecycleSecret)
    let interrupted = false
    const store = {
      ...base,
      async hasActiveHumanAccount(state: Parameters<typeof base.hasActiveHumanAccount>[0]) {
        const available = await base.hasActiveHumanAccount(state)
        if (!interrupted) {
          interrupted = true
          await base.anonymizeParticipant(humanId)
        }
        return available
      },
    }
    expect(await createTenderBotRunner({ store, tender: createTenderModule({ store }) }).advance({ limit: 10 }))
      .toEqual({ acceptedCommands: 0, failedTenders: 0 })
    expect(await countCommands(tenderId)).toBe(0)
    expect((await runWorker({ mode: 'none', tenderId })).result?.failedTenders).toBe(0)
    expect(await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).toMatchObject({ phase: 'complete' })
    expect(await countCommands(tenderId)).toBe(0)
  })

  test('separate processes recover three bots after a lost acknowledgement without duplicating any slot decision', async () => {
    const { tenderId } = await createBotTender(3)
    expect((await runWorker({ mode: 'exitaftercommit', tenderId })).exitCode).toBe(18)
    const concurrent = await Promise.all([runWorker({ mode: 'none', tenderId }), runWorker({ mode: 'none', tenderId })])
    expect(concurrent.every((result) => result.exitCode === 0 && result.result?.failedTenders === 0)).toBe(true)
    for (let pass = 0; pass < 3; pass += 1) {
      expect((await runWorker({ mode: 'none', tenderId })).result?.failedTenders).toBe(0)
    }
    const state = (await createPrismaTenderStore(prisma).read(tenderId))!
    expect(Object.keys(state.requestedSlots).sort()).toEqual(['bot-1', 'bot-2', 'bot-3'])
    expect(state.version).toBe(3)
    expect(await countCommands(tenderId)).toBe(3)
  })

  test('two independent Bun workers accept one bot decision for one Tender version', async () => {
    const { tenderId } = await createBotTender()
    const [first, second] = await Promise.all([
      runWorker({ mode: 'none', tenderId }),
      runWorker({ mode: 'none', tenderId }),
    ])

    expect([first.exitCode, second.exitCode]).toEqual([0, 0])
    expect((first.result?.acceptedCommands ?? 0) + (second.result?.acceptedCommands ?? 0)).toBeGreaterThanOrEqual(1)
    expect((first.result?.acceptedCommands ?? 0) + (second.result?.acceptedCommands ?? 0)).toBeLessThanOrEqual(2)
    expect([first.result?.failedTenders, second.result?.failedTenders]).toEqual([0, 0])
    expect(await countCommands(tenderId)).toBe(1)
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).version).toBe(1)
  })

  test('retries a bot decision after a worker exits before commit', async () => {
    const { tenderId } = await createBotTender()
    await expect(runWorker({ mode: 'exitbeforecommit', tenderId })).resolves.toMatchObject({ exitCode: 17, result: undefined })
    expect(await countCommands(tenderId)).toBe(0)

    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 1, failedTenders: 0 },
    })
    expect(await countCommands(tenderId)).toBe(1)
  })

  test('does not duplicate an accepted bot decision after a worker exits before acknowledgement', async () => {
    const { tenderId } = await createBotTender()
    await expect(runWorker({ mode: 'exitaftercommit', tenderId })).resolves.toMatchObject({ exitCode: 18, result: undefined })
    expect(await countCommands(tenderId)).toBe(1)
    const version = (await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).version

    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 0, failedTenders: 0 },
    })
    expect(await countCommands(tenderId)).toBe(1)
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).version).toBe(version)
  })

  test('does not accept a stale bot decision after the deadline wins', async () => {
    const { tenderId } = await createBotTender()
    await expect(runWorker({ mode: 'deadlinebeforecommit', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 0, deadlineAdvanced: true, failedTenders: 0 },
    })
    expect(await countCommands(tenderId)).toBe(0)
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).version).toBe(1)
  })

  test.each([1, 2, 3])('permanent last-human forfeit ends a one-human-%i-bot Tender without a bot winner', async (botCount) => {
    const { humanId, tenderId } = await createBotTender(botCount)
    const tender = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    await tender.execute({ actorId: humanId, commandId: `forfeit-${botCount}`, tenderId, type: 'forfeit-tender' })

    const persisted = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })
    expect(persisted).toMatchObject({ phase: 'complete' })
    expect((persisted.state as { completionReason?: string; winnerPlayerIds?: string[] })).toMatchObject({
      completionReason: 'no_human_players',
      winnerPlayerIds: [],
    })
    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 0, failedTenders: 0 },
    })
  })

  test('forfeiting one human while another remains does not end a mixed Tender', async () => {
    const [firstHuman, secondHuman] = await Promise.all([
      createHuman('runtime-first-human'), createHuman('runtime-second-human'),
    ])
    const tender = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    const { tenderId } = await tender.createTender({
      players: [
        { id: firstHuman.id, tiePriority: 1 },
        { id: secondHuman.id, tiePriority: 2 },
        { bot: { difficulty: 'easy', strategyVersion: 'bot-v2' }, id: 'bot-1', tiePriority: 3 },
      ],
    })
    await tender.execute({ actorId: firstHuman.id, commandId: 'forfeit-one-human', tenderId, type: 'forfeit-tender' })

    expect(await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).toMatchObject({ phase: 'access-slot-selection' })
    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 1, failedTenders: 0 },
    })
  })

  test('temporary leave and resume does not become a permanent forfeit', async () => {
    const { humanId, tenderId } = await createBotTender(2)
    const first = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    await first.execute({ actorId: humanId, commandId: 'temporary-leave', tenderId, type: 'leave-tender' })
    const restarted = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    await restarted.execute({ actorId: humanId, commandId: 'temporary-resume', tenderId, type: 'resume-tender' })

    const persisted = (await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).state as {
      completionReason?: string
      forfeitedAtByPlayer?: Record<string, string>
    }
    expect(persisted.forfeitedAtByPlayer?.[humanId]).toBeUndefined()
    expect(persisted.completionReason).not.toBe('no_human_players')
  })

  test.each([1, 2])('terminates without a bot command when the final human account is anonymized before cleanup (%i bots)', async (botCount) => {
    const { humanId, tenderId } = await createBotTender(botCount)
    await prisma.user.update({ where: { id: humanId }, data: { anonymizedAt: new Date() } })

    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 0, failedTenders: 0 },
    })
    expect(await countCommands(tenderId)).toBe(0)
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } }).then((record) => record.state))).toMatchObject({
      completionReason: 'no_human_players', winnerPlayerIds: [],
    })
  })

  test.each([1, 3])('terminates after final human pseudonymization without UUID casts (%i bots)', async (botCount) => {
    const { humanId, tenderId } = await createBotTender(botCount)
    await prisma.$transaction((transaction) => anonymizePrismaTenderParticipant(transaction, humanId))

    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({
      exitCode: 0,
      result: { acceptedCommands: 0, failedTenders: 0 },
    })
    expect(await countCommands(tenderId)).toBe(0)
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } }).then((record) => record.state))).toMatchObject({
      completionReason: 'no_human_players', winnerPlayerIds: [],
    })
  })

  test('keeps a mixed Tender active after pseudonymizing only one of two humans', async () => {
    const [first, second] = await Promise.all([createHuman('deleted-one-a'), createHuman('deleted-one-b')])
    const tender = createTenderModule({ store: createPrismaTenderStore(prisma, accountLifecycleSecret) })
    const { tenderId } = await tender.createTender({ players: [
      { id: first.id, tiePriority: 1 }, { id: second.id, tiePriority: 2 },
      { bot: { difficulty: 'easy', strategyVersion: 'bot-v2' }, id: 'bot-1', tiePriority: 3 },
    ] })
    await prisma.$transaction((transaction) => anonymizePrismaTenderParticipant(transaction, first.id))

    await expect(runWorker({ mode: 'none', tenderId })).resolves.toMatchObject({ exitCode: 0, result: { failedTenders: 0 } })
    expect(await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).toMatchObject({ phase: 'access-slot-selection' })
    expect(await countCommands(tenderId)).toBe(1)
  })
})
