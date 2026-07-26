type WorkerLoopState = {
  consecutiveFailures: number
  intervalMs: number
  label: string
  lastError: string | null
  lastStartedAt: number | null
  lastSucceededAt: number | null
  running: boolean
}

type WorkerLoopSnapshot = WorkerLoopState & {
  stale: boolean
}

export type WorkerHealthSnapshot = {
  loops: WorkerLoopSnapshot[]
  ready: boolean
}

export type WorkerLoopHealth = {
  failed: (error: unknown) => void
  started: () => void
  succeeded: () => void
}

export function createWorkerHealth({
  now = Date.now,
  staleMultiplier = 3,
}: {
  now?: () => number
  staleMultiplier?: number
} = {}) {
  const loops = new Map<string, WorkerLoopState>()

  function registerLoop({
    intervalMs,
    label,
  }: {
    intervalMs: number
    label: string
  }): WorkerLoopHealth {
    if (loops.has(label)) {
      throw new Error(`Worker health loop "${label}" is already registered`)
    }

    const state: WorkerLoopState = {
      consecutiveFailures: 0,
      intervalMs,
      label,
      lastError: null,
      lastStartedAt: null,
      lastSucceededAt: null,
      running: false,
    }
    loops.set(label, state)

    return {
      failed(error) {
        state.consecutiveFailures += 1
        state.lastError = error instanceof Error ? error.message : String(error)
        state.running = false
      },
      started() {
        state.lastStartedAt = now()
        state.running = true
      },
      succeeded() {
        state.consecutiveFailures = 0
        state.lastError = null
        state.lastSucceededAt = now()
        state.running = false
      },
    }
  }

  function snapshot(): WorkerHealthSnapshot {
    const currentTime = now()
    const loopSnapshots = [...loops.values()].map((loop): WorkerLoopSnapshot => {
      const staleAfterMs = Math.max(loop.intervalMs * staleMultiplier, 5_000)
      const stale =
        loop.lastSucceededAt === null || currentTime - loop.lastSucceededAt > staleAfterMs

      return {
        ...loop,
        stale,
      }
    })

    return {
      loops: loopSnapshots,
      ready:
        loopSnapshots.length > 0 &&
        loopSnapshots.every((loop) => !loop.stale && loop.consecutiveFailures === 0),
    }
  }

  async function fetch(request: Request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/health/live') {
      return Response.json({ status: 'ok' })
    }
    if (pathname === '/health/ready') {
      const status = snapshot().ready ? 'ok' : 'unavailable'
      return Response.json({ status }, { status: status === 'ok' ? 200 : 503 })
    }
    return new Response('Not Found', { status: 404 })
  }

  return {
    fetch,
    registerLoop,
    snapshot,
  }
}
