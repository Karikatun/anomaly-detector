import { createApp } from './app'
import {
  createPrismaRealtimeTicketStore,
  createPrismaTenderStore,
  createRealtimeHub,
  createRealtimeWebSocketHandlers,
  createTenderModule,
  upgradeRealtimeWebSocket,
  type RealtimeHub,
  type RealtimeSocketData,
} from './modules/tender'
import { createBackendRuntime } from './runtime'
import { stopServerGracefully } from './shutdown'

const runtime = createBackendRuntime()
const ticketStore = createPrismaRealtimeTicketStore(runtime.prisma, {
  sessionAbsoluteTtlDays: runtime.env.SESSION_ABSOLUTE_TTL_DAYS,
})
const tenderStore = createPrismaTenderStore(runtime.prisma)

let realtime: RealtimeHub
const tender = createTenderModule({
  onTenderChanged: (tenderId) => {
    void realtime?.handleTenderChanged(tenderId)
  },
  store: tenderStore,
})
realtime = createRealtimeHub({ tender })

const stopRealtimeSyncLoop = realtime.startSyncLoop()

const app = createApp({ env: runtime.env, prisma: runtime.prisma, tender })

const server = Bun.serve<RealtimeSocketData>({
  port: runtime.env.PORT,
  fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/api/realtime/ws') {
      return upgradeRealtimeWebSocket({ hub: realtime, request, server, ticketStore })
    }
    return app.fetch(request)
  },
  websocket: createRealtimeWebSocketHandlers({ hub: realtime }),
})

console.log(`Backend listening on ${server.url}`)

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`Backend received ${signal}; shutting down`)
  stopRealtimeSyncLoop()
  await stopServerGracefully(server, runtime.env.SHUTDOWN_GRACE_SECONDS * 1000)
  await runtime.close()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
