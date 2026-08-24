import type { RealtimeServerMessage } from '@anomaly-detector/contracts'

import type { TenderModule } from '../application/tender-module'
import { TenderFailure } from '../domain/errors'
import { RealtimeFailure, type RealtimePrincipal } from './errors'

type RealtimeFailureClose = {
  code: 1011 | 4401 | 4404 | 4429
  reason: 'Internal error' | 'Try again later' | 'Unauthorized' | 'Unavailable'
  reportAsError: boolean
}

export function resolveRealtimeFailureClose(failure: unknown): RealtimeFailureClose {
  if (failure instanceof RealtimeFailure && failure.kind === 'realtime_session_invalid') {
    return { code: 4401, reason: 'Unauthorized', reportAsError: false }
  }
  if (failure instanceof RealtimeFailure && failure.kind === 'realtime_subscription_limit') {
    return { code: 4429, reason: 'Try again later', reportAsError: false }
  }
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
  ready: boolean
  sessionId: string
  socket: RealtimeSocket
  tenderId: string
  version: number
}

type RealtimeHubOptions = {
  onTenderChanged?: (tenderId: string) => void
  sessionGuard: RealtimeSessionGuard
  tender: TenderModule
}

export type RealtimeSessionGuard = {
  isActive(input: RealtimePrincipal): Promise<boolean>
  runWhileActive(input: RealtimePrincipal, action: () => void): Promise<boolean>
}

const MAX_SUBSCRIPTIONS_PER_PLAYER = 10

export function createRealtimeHub({ onTenderChanged, sessionGuard, tender }: RealtimeHubOptions) {
  const subscriptions = new Set<Subscription>()

  const deliver = (socket: RealtimeSocket, message: RealtimeServerMessage) => {
    socket.send(JSON.stringify(message))
  }

  const deliverUpdatedView = (
    subscription: Subscription,
    view: Extract<RealtimeServerMessage, { type: 'tender-view' }>['view'],
  ) => {
    if (!subscriptions.has(subscription) || view.version <= subscription.version) return
    subscription.version = view.version
    deliver(subscription.socket, { type: 'tender-view', view })
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

  const inactiveSessionFailure = () => new RealtimeFailure(
    'realtime_session_invalid',
    'Realtime session is invalid or expired',
  )

  const closeInactiveSubscription = (subscription: Subscription) => {
    closeFailedSubscription(
      subscription,
      'Realtime subscriber session became invalid:',
      inactiveSessionFailure(),
    )
  }

  const deliverCurrentView = async (subscription: Subscription) => {
    if (!subscription.ready || !subscriptions.has(subscription)) return
    const view = await tender.readTenderView({
      playerId: subscription.playerId,
      tenderId: subscription.tenderId,
    })
    if (!subscriptions.has(subscription)) return

    const principal = {
      sessionId: subscription.sessionId,
      userId: subscription.playerId,
    }
    const active = await sessionGuard.runWhileActive(principal, () => {
      deliverUpdatedView(subscription, view)
    })
    if (!subscriptions.has(subscription)) return
    if (!active) {
      closeInactiveSubscription(subscription)
    }
  }

  const publish = async (tenderId: string) => {
    const targets = [...subscriptions].filter(
      (subscription) => subscription.ready && subscription.tenderId === tenderId,
    )
    await Promise.all(targets.map(async (subscription) => {
      try {
        await deliverCurrentView(subscription)
      } catch (error) {
        closeFailedSubscription(subscription, 'Realtime subscriber delivery failed:', error)
      }
    }))
  }

  const syncActiveTenders = async () => {
    const targets = [...subscriptions].filter((subscription) => subscription.ready)
    await Promise.all(targets.map(async (subscription) => {
      try {
        await deliverCurrentView(subscription)
      } catch (error) {
        closeFailedSubscription(subscription, 'Realtime subscriber synchronisation failed:', error)
      }
    }))
  }

  return {
    closeSession(sessionId: string) {
      for (const subscription of [...subscriptions]) {
        if (subscription.sessionId === sessionId) closeInactiveSubscription(subscription)
      }
    },
    async handleTenderChanged(tenderId: string) {
      await publish(tenderId)
    },
    async subscribe(input: {
      playerId: string
      sessionId: string
      socket: RealtimeSocket
      tenderId: string
    }): Promise<RealtimeSubscription> {
      const activeForPlayer = [...subscriptions].filter(
        (subscription) => subscription.playerId === input.playerId,
      ).length
      if (activeForPlayer >= MAX_SUBSCRIPTIONS_PER_PLAYER) {
        throw new RealtimeFailure(
          'realtime_subscription_limit',
          'Realtime subscription limit reached',
        )
      }
      const principal = { sessionId: input.sessionId, userId: input.playerId }
      const subscription: Subscription = {
        playerId: input.playerId,
        ready: false,
        sessionId: input.sessionId,
        socket: input.socket,
        tenderId: input.tenderId,
        version: -1,
      }
      subscriptions.add(subscription)
      try {
        if (!await sessionGuard.isActive(principal) || !subscriptions.has(subscription)) {
          throw inactiveSessionFailure()
        }

        const view = await tender.readTenderView({
          playerId: input.playerId,
          tenderId: input.tenderId,
        })
        if (!subscriptions.has(subscription)) throw inactiveSessionFailure()
        const active = await sessionGuard.runWhileActive(principal, () => {
          if (!subscriptions.has(subscription)) return
          subscription.ready = true
          deliverUpdatedView(subscription, view)
        })
        if (!active || !subscriptions.has(subscription)) {
          throw inactiveSessionFailure()
        }
        return {
          close: async () => {
            subscriptions.delete(subscription)
          },
        }
      } catch (error) {
        subscriptions.delete(subscription)
        throw error
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
