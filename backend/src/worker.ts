import { createBackendRuntime } from './runtime'
import { createPrismaTenderStore } from './modules/tender'
import { createTenderModule } from './modules/tender'

export async function runWorker() {
  const runtime = createBackendRuntime()
  const store = createPrismaTenderStore(runtime.prisma)
  const tender = createTenderModule({ store })

  console.log('Worker: starting advance loop for due tenders')
  const stop = tender.startAdvanceLoop(2_000)

  const shutdown = (signal: string) => {
    console.log(`Worker: received ${signal}; shutting down`)
    stop()
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