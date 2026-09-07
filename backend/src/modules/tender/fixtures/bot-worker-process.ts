import { createPrisma } from '../../../db'
import { createTenderBotRunner } from '../application/bot-runner'
import { createTenderService } from '../application/tender-service'
import { createPrismaTenderStore } from '../infrastructure/prisma-tender-store'
import type { TenderStore } from '../application/tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const tenderId = process.env.BOT_WORKER_TENDER_ID
const mode = process.env.BOT_WORKER_TEST_MODE
const accountLifecycleSecret = process.env.BOT_WORKER_ACCOUNT_LIFECYCLE_SECRET

if (!databaseUrl || !tenderId || !accountLifecycleSecret) {
  throw new Error('Missing isolated bot worker test environment')
}
if (!['none', 'exitbeforecommit', 'exitaftercommit', 'deadlinebeforecommit'].includes(mode ?? '')) {
  throw new Error('Invalid bot worker test mode')
}

const prisma = createPrisma(databaseUrl)
const baseStore = createPrismaTenderStore(prisma, accountLifecycleSecret)
let intercepted = false
let deadlineAdvanced = false

const store: TenderStore = {
  ...baseStore,
  async commit(change) {
    if (!intercepted) {
      intercepted = true
      if (mode === 'exitbeforecommit') process.exit(17)
      if (mode === 'deadlinebeforecommit') {
        const current = await baseStore.read(change.tenderId)
        if (!current?.dueAt) throw new Error('Expected a due Tender before stale bot commit')
        const deadlines = createTenderService({ store: baseStore, seedGenerator: () => 'bot-runtime-test' })
        const result = await deadlines.advanceDueTenders({
          limit: 1,
          now: new Date(current.dueAt.getTime() + 1),
        })
        if (!result.advancedTenderIds.includes(change.tenderId)) {
          throw new Error('Expected deadline advance to win stale bot decision')
        }
        deadlineAdvanced = true
      }
    }
    const result = await baseStore.commit(change)
    if (mode === 'exitaftercommit' && result.kind === 'committed') process.exit(18)
    return result
  },
  async findBotTenders(input) {
    return (await baseStore.findBotTenders(input)).filter((candidate) => candidate === tenderId)
  },
}

try {
  const runner = createTenderBotRunner({ store, tender: createTenderService({ store, seedGenerator: () => 'bot-runtime-test' }) })
  const result = await runner.advance({ limit: 1 })
  process.stdout.write(`${JSON.stringify({ ...result, deadlineAdvanced, status: 'ok' })}\n`)
} finally {
  await prisma.$disconnect()
}
