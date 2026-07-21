import type { RealtimeServerMessage } from '@the-game/contracts'

import type { createTenderModule } from '../index'

export type RealtimeSocket = {
  send(message: string): void
}

export type RealtimeSubscription = {
  close(): Promise<void>
}

type TenderModule = ReturnType<typeof createTenderModule>

type Subscription = {
  playerId: string
  socket: RealtimeSocket
  tenderId: string
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

  const publish = async (tenderId: string) => {
    const targets = [...subscriptions].filter((subscription) => subscription.tenderId === tenderId)
    await Promise.all(targets.map(async (subscription) => {
      const view = await tender.readTenderView({
        playerId: subscription.playerId,
        tenderId: subscription.tenderId,
      })
      deliver(subscription.socket, { type: 'tender-view', view })
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
      }
      subscriptions.add(subscription)
      deliver(input.socket, { type: 'tender-view', view })
      return {
        close: async () => {
          subscriptions.delete(subscription)
        },
      }
    },
    tenderChanged(tenderId: string) {
      onTenderChanged?.(tenderId)
    },
  }
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>
