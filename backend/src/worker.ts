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
  const stopTenderAdvanceLoop = tender.startAdvanceLoop(2_000)
  const roomStartInterval = setInterval(() => {
    void roomStart.advanceDueRoomStarts({ now: new Date() }).catch(() => {
      // The next loop retries an unstarted Room after a transient database failure.
    })
  }, 250)
  roomStartInterval.unref?.()

  const shutdown = (signal: string) => {
    console.log(`Worker: received ${signal}; shutting down`)
    stopTenderAdvanceLoop()
    clearInterval(roomStartInterval)
    void runtime.close()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export async function main() {
  await runWorker()
}

if (import.meta.main) {
  await main()
}
