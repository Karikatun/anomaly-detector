import type { RealtimeServerMessage } from '@anomaly-detector/contracts'

import type { TenderModule } from '../application/tender-module'
import { TenderFailure } from '../domain/errors'

type RealtimeFailureClose = {
  code: 1011 | 4404
  reason: 'Internal error' | 'Unavailable'
  reportAsError: boolean
}

export function resolveRealtimeFailureClose(failure: unknown): RealtimeFailureClose {
  if (failure instanceof TenderFailure && (
    failure.kind === 'tender_not_found'
    || failure.kind === 'player_not_in_tender'
    || failure.kind === 'player_forfeited'
  )) {
    return { code: 4404, reason: 'Unavailable', reportAsError: false }
  }
  return { code: 1011, reason: 'Internal error', reportAsError: true }
}

export type RealtimeSocket = {
  close(code: number, reason: string): void
  send(message: string): void
}

export type RealtimeSubscription = {
  close(): Promise<void>
}

type Subscription = {
  playerId: string
  socket: RealtimeSocket
  tenderId: string
  version: number
}

type RealtimeHubOptions = {
  onTenderChanged?: (tenderId: string) => void
  tender: TenderModule
}

export function createRealtimeHub({ onTenderChanged, tender }: RealtimeHubOptions) {
  const subscriptions = new Set<Subscription>()

  const deliver = (socket: RealtimeSocket, message: RealtimeServerMessage) => {
    socket.send(JSON.stringify(message))
  }

  const closeFailedSubscription = (
    subscription: Subscription,
    message: string,
    error: unknown,
  ) => {
    if (!subscriptions.delete(subscription)) return
    const failureClose = resolveRealtimeFailureClose(error)
    try {
      subscription.socket.close(failureClose.code, failureClose.reason)
    } catch (closeError) {
      console.error('Realtime subscriber socket close failed:', closeError)
    }
    if (failureClose.reportAsError) console.error(message, error)
  }

  const publish = async (tenderId: string) => {
    const targets = [...subscriptions].filter((subscription) => subscription.tenderId === tenderId)
    await Promise.all(targets.map(async (subscription) => {
      try {
        const view = await tender.readTenderView({
          playerId: subscription.playerId,
          tenderId: subscription.tenderId,
        })
        subscription.version = view.version
        deliver(subscription.socket, { type: 'tender-view', view })
      } catch (error) {
        closeFailedSubscription(subscription, 'Realtime subscriber delivery failed:', error)
      }
    }))
  }

  const syncActiveTenders = async () => {
    await Promise.all([...subscriptions].map(async (subscription) => {
      try {
        const view = await tender.readTenderView({
          playerId: subscription.playerId,
          tenderId: subscription.tenderId,
        })
        if (view.version === subscription.version) return

        subscription.version = view.version
        deliver(subscription.socket, { type: 'tender-view', view })
      } catch (error) {
        closeFailedSubscription(subscription, 'Realtime subscriber synchronisation failed:', error)
      }
    }))
  }

  return {
    async handleTenderChanged(tenderId: string) {
      await publish(tenderId)
    },
    async subscribe(input: {
      playerId: string
      socket: RealtimeSocket
      tenderId: string
    }): Promise<RealtimeSubscription> {
      const view = await tender.readTenderView({
        playerId: input.playerId,
        tenderId: input.tenderId,
      })
      const subscription: Subscription = {
        playerId: input.playerId,
        socket: input.socket,
        tenderId: input.tenderId,
        version: view.version,
      }
      deliver(input.socket, { type: 'tender-view', view })
      subscriptions.add(subscription)
      return {
        close: async () => {
          subscriptions.delete(subscription)
        },
      }
    },
    tenderChanged(tenderId: string) {
      onTenderChanged?.(tenderId)
    },
    syncActiveTenders,
    startSyncLoop(intervalMs: number = 1_000): () => Promise<void> {
      let currentRun: Promise<void> | undefined
      let stopped = false
      const tick = () => {
        if (stopped || currentRun) return
        currentRun = syncActiveTenders()
          .catch((error) => console.error('Realtime Tender sync failed:', error))
          .finally(() => { currentRun = undefined })
      }
      const timer = setInterval(tick, intervalMs)
      return async () => {
        if (!stopped) {
          stopped = true
          clearInterval(timer)
        }
        await currentRun
      }
    },
  }
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>
