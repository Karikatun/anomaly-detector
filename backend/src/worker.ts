import { createBackendRuntime } from './runtime'
import { createRoomStartModule } from './modules/room'
import { createPrismaTenderStore } from './modules/tender'
import { createTenderModule } from './modules/tender'

export async function runWorker() {
  const runtime = createBackendRuntime()
  const store = createPrismaTenderStore(runtime.prisma)
  const tender = createTenderModule({ store })
  const roomStart = createRoomStartModule(runtime.prisma)

  console.log('Worker: starting advance loops for due Tenders and Rooms')
  const stopTenderAdvanceLoop = startPollingLoop({
    intervalMs: 2_000,
    label: 'Tender advancement',
    task: async () => {
      const result = await tender.advanceDueTenders({ limit: 50, now: new Date() })
      await roomStart.releaseCompletedCurrentMatches()
      return result
    },
  })
  const stopRoomStartLoop = startPollingLoop({
    intervalMs: 250,
    label: 'Room start',
    task: () => roomStart.advanceDueRoomStarts({ now: new Date() }),
  })

  const shutdown = (signal: string) => {
    console.log(`Worker: received ${signal}; shutting down`)
    stopTenderAdvanceLoop()
    stopRoomStartLoop()
    void runtime.close()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

function startPollingLoop(input: {
  intervalMs: number
  label: string
  task: () => Promise<unknown>
}) {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void input.task()
      .catch((error) => console.error(`Worker: ${input.label} failed`, error))
      .finally(() => { running = false })
  }, input.intervalMs)
  return () => clearInterval(timer)
}

export async function main() {
  await runWorker()
}

if (import.meta.main) {
  await main()
}
