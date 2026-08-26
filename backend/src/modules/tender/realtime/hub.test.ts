import { describe, expect, spyOn, test } from 'bun:test'

import { TenderFailure } from '../domain/errors'
import { createTenderModule } from '../index'
import { createInMemoryTenderStore } from '../infrastructure/in-memory-tender-store'
import {
  createRealtimeHub as createConfiguredRealtimeHub,
  type RealtimeSocket,
} from './hub'

const players = [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }]

type RealtimeHubOptions = Parameters<typeof createConfiguredRealtimeHub>[0]
type IsSessionActive = RealtimeHubOptions['sessionGuard']['isActive']

const createRealtimeHub = (
  input: Omit<RealtimeHubOptions, 'sessionGuard'> & { isSessionActive?: IsSessionActive },
) => {
  const { isSessionActive = async () => true, ...options } = input
  const hub = createConfiguredRealtimeHub({
    ...options,
    sessionGuard: {
      isActive: isSessionActive,
      runWhileActive: async (principal, action) => {
        if (!await isSessionActive(principal)) return false
        action()
        return true
      },
    },
  })
  return {
    ...hub,
    subscribe(subscription: Omit<Parameters<typeof hub.subscribe>[0], 'sessionId'> & {
      sessionId?: string
    }) {
      const {
        sessionId = `session-${subscription.playerId}`,
        ...rest
      } = subscription
      return hub.subscribe({ ...rest, sessionId })
    },
  }
}

const collectSocket = () => {
  const closeEvents: Array<{ code: number; reason: string }> = []
  const messages: string[] = []
  const socket = {
    close: (code: number, reason: string) => { closeEvents.push({ code, reason }) },
    send: (message) => { messages.push(message) },
  } satisfies RealtimeSocket
  return { closeEvents, messages, socket }
}

const exerciseConcurrentFailedReads = async (failure: Error) => {
  const baseTender = createTenderModule()
  const { tenderId } = await baseTender.createTender({ players })
  let failPlayerARead = false
  let failedReads = 0
  let markBothReadsStarted = () => {}
  const bothReadsStarted = new Promise<void>((resolve) => {
    markBothReadsStarted = resolve
  })
  let releaseFailedReads = () => {}
  const failedReadsReleased = new Promise<void>((resolve) => {
    releaseFailedReads = resolve
  })
  const tender = {
    ...baseTender,
    async readTenderView(input: Parameters<typeof baseTender.readTenderView>[0]) {
      if (failPlayerARead && input.playerId === 'player-a') {
        failedReads += 1
        if (failedReads === 2) markBothReadsStarted()
        await failedReadsReleased
        throw failure
      }
      return baseTender.readTenderView(input)
    },
  }
  const hub = createRealtimeHub({ tender })
  const failed = collectSocket()
  const healthy = collectSocket()
  await hub.subscribe({ playerId: 'player-a', socket: failed.socket, tenderId })
  await hub.subscribe({ playerId: 'player-b', socket: healthy.socket, tenderId })
  await baseTender.execute({
    actorId: 'player-a',
    commandId: 'command-concurrent-read-failure',
    slot: 1,
    tenderId,
    type: 'request-access-slot',
  })
  failPlayerARead = true

  const publishing = hub.handleTenderChanged(tenderId)
  const synchronising = hub.syncActiveTenders()
  await bothReadsStarted
  releaseFailedReads()
  await Promise.all([publishing, synchronising])

  return { failed, failedReads, healthy, hub, tenderId }
}

describe('realtime hub', () => {
  test('delivers every private view inside the active-session critical section', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    let insideActiveSession = false
    const sentInsideGuard: boolean[] = []
    const hub = createConfiguredRealtimeHub({
      sessionGuard: {
        isActive: async () => true,
        runWhileActive: async (_principal, deliver) => {
          insideActiveSession = true
          try {
            deliver()
            return true
          } finally {
            insideActiveSession = false
          }
        },
      },
      tender,
    })
    const socket: RealtimeSocket = {
      close: () => undefined,
      send: () => { sentInsideGuard.push(insideActiveSession) },
    }

    await hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-a',
      socket,
      tenderId,
    })
    await tender.execute({
      actorId: 'player-a',
      commandId: 'guarded-private-delivery',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    await hub.syncActiveTenders()

    expect(sentInsideGuard).toEqual([true, true])
  })

  test('does not deliver a view rejected by the final exact-session guard', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let guardedDeliveries = 0
    let viewReads = 0
    const hub = createConfiguredRealtimeHub({
      sessionGuard: {
        isActive: async () => true,
        runWhileActive: async (_principal, deliver) => {
          guardedDeliveries += 1
          if (guardedDeliveries > 1) return false
          deliver()
          return true
        },
      },
      tender: {
        ...baseTender,
        async readTenderView(input) {
          viewReads += 1
          return baseTender.readTenderView(input)
        },
      },
    })
    const subscriber = collectSocket()
    await hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-a',
      socket: subscriber.socket,
      tenderId,
    })
    await baseTender.execute({
      actorId: 'player-a',
      commandId: 'guard-rejects-after-read',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })

    await hub.syncActiveTenders()

    expect({ guardedDeliveries, viewReads }).toEqual({ guardedDeliveries: 2, viewReads: 2 })
    expect(subscriber.messages).toHaveLength(1)
    expect(subscriber.closeEvents).toEqual([{ code: 4401, reason: 'Unauthorized' }])
  })

  test('rejects an inactive exact session before reading a private Tender view', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let viewReads = 0
    const hub = createRealtimeHub({
      isSessionActive: async (principal) => {
        expect(principal).toEqual({ sessionId: 'session-a', userId: 'player-a' })
        return false
      },
      tender: {
        ...baseTender,
        async readTenderView(input) {
          viewReads += 1
          return baseTender.readTenderView(input)
        },
      },
    })
    const subscriber = collectSocket()

    await expect(hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-a',
      socket: subscriber.socket,
      tenderId,
    })).rejects.toMatchObject({ kind: 'realtime_session_invalid' })
    expect(viewReads).toBe(0)
    expect(subscriber.messages).toEqual([])
  })

  test('closes only the logged-out session while another session for the same player remains live', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ isSessionActive: async () => true, tender })
    const loggedOut = collectSocket()
    const active = collectSocket()
    await hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-logged-out',
      socket: loggedOut.socket,
      tenderId,
    })
    await hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-active',
      socket: active.socket,
      tenderId,
    })

    await hub.closeSession('session-logged-out')
    await tender.execute({
      actorId: 'player-a',
      commandId: 'session-scoped-close',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    await hub.handleTenderChanged(tenderId)

    expect(loggedOut.closeEvents).toEqual([{ code: 4401, reason: 'Unauthorized' }])
    expect(loggedOut.messages).toHaveLength(1)
    expect(active.closeEvents).toEqual([])
    expect(active.messages).toHaveLength(2)
  })

  test('caps active subscriptions per player without evicting existing sockets or growing sync work', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let sessionChecks = 0
    let viewReads = 0
    const hub = createRealtimeHub({
      isSessionActive: async () => {
        sessionChecks += 1
        return true
      },
      tender: {
        ...baseTender,
        async readTenderView(input) {
          viewReads += 1
          return baseTender.readTenderView(input)
        },
      },
    })
    const activeSockets = Array.from({ length: 10 }, collectSocket)
    const activeSubscriptions = []
    for (const [index, subscriber] of activeSockets.entries()) {
      activeSubscriptions.push(await hub.subscribe({
        playerId: 'player-a',
        sessionId: `session-${index}`,
        socket: subscriber.socket,
        tenderId,
      }))
    }
    const overflow = collectSocket()

    await expect(hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-overflow',
      socket: overflow.socket,
      tenderId,
    })).rejects.toMatchObject({ kind: 'realtime_subscription_limit' })
    expect(overflow.messages).toEqual([])

    await baseTender.execute({
      actorId: 'player-a',
      commandId: 'bounded-subscription-work',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    await hub.handleTenderChanged(tenderId)
    expect(activeSockets.every((subscriber) => subscriber.messages.length === 2)).toBe(true)

    sessionChecks = 0
    viewReads = 0
    await hub.syncActiveTenders()
    expect({ sessionChecks, viewReads }).toEqual({ sessionChecks: 10, viewReads: 10 })

    await activeSubscriptions[0]?.close()
    const replacement = collectSocket()
    await expect(hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-replacement',
      socket: replacement.socket,
      tenderId,
    })).resolves.toBeDefined()
    expect(replacement.messages).toHaveLength(1)
  })

  test('does not deliver an initial view when logout races a stale session validation', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    let validationCount = 0
    let markSecondValidationStarted: () => void = () => undefined
    const secondValidationStarted = new Promise<void>((resolve) => {
      markSecondValidationStarted = resolve
    })
    let releaseSecondValidation: () => void = () => undefined
    const secondValidationReleased = new Promise<void>((resolve) => {
      releaseSecondValidation = resolve
    })
    const hub = createRealtimeHub({
      async isSessionActive() {
        validationCount += 1
        if (validationCount === 2) {
          markSecondValidationStarted()
          await secondValidationReleased
        }
        return true
      },
      tender,
    })
    const subscriber = collectSocket()

    const subscribing = hub.subscribe({
      playerId: 'player-a',
      sessionId: 'session-racing-logout',
      socket: subscriber.socket,
      tenderId,
    })
    await secondValidationStarted
    hub.closeSession('session-racing-logout')
    releaseSecondValidation()

    await expect(subscribing).rejects.toMatchObject({ kind: 'realtime_session_invalid' })
    expect(subscriber.closeEvents).toEqual([{ code: 4401, reason: 'Unauthorized' }])
    expect(subscriber.messages).toEqual([])
  })

  test('sends the current participant Tender view on subscribe', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const { messages, socket } = collectSocket()

    await hub.subscribe({ playerId: 'player-a', socket, tenderId })

    expect(messages).toHaveLength(1)
    const message = JSON.parse(messages[0])
    expect(message.type).toBe('tender-view')
    expect(message.view.tenderId).toBe(tenderId)
    expect(message.view.phase).toBe('access-slot-selection')
    expect(message.view.players.map((player: { playerId: string }) => player.playerId)).toEqual(['player-a', 'player-b'])
  })

  test('rejects a non-participant without touching the socket', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const { messages, socket } = collectSocket()

    await expect(hub.subscribe({ playerId: 'player-c', socket, tenderId }))
      .rejects.toMatchObject({ kind: 'player_not_in_tender' })
    expect(messages).toHaveLength(0)
  })

  test('broadcasts each participant their own authorised view after a command', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const first = collectSocket()
    const second = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: first.socket, tenderId })
    await hub.subscribe({ playerId: 'player-b', socket: second.socket, tenderId })

    await tender.execute({
      actorId: 'player-a',
      commandId: 'command-1',
      slot: 3,
      tenderId,
      type: 'request-access-slot',
    })
    await hub.handleTenderChanged(tenderId)

    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(2)
    const firstView = JSON.parse(first.messages[1]).view
    const secondView = JSON.parse(second.messages[1]).view
    expect(firstView.players).toHaveLength(2)
    // The acting player privately sees their requested slot; the opponent must not.
    expect(firstView.players.find((player: { playerId: string }) => player.playerId === 'player-a').requestedAccessSlot).toBe(3)
    expect(secondView.players.find((player: { playerId: string }) => player.playerId === 'player-a').requestedAccessSlot).toBeUndefined()
  })

  test('notifies subscribers when the worker advances a due Tender', async () => {
    let now = new Date('2026-07-21T12:00:00Z')
    const tender = createTenderModule({ now: () => now })
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const { messages, socket } = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket, tenderId })

    now = new Date(now.getTime() + 90_000)
    const result = await tender.advanceDueTenders({ limit: 10, now })
    await hub.handleTenderChanged(tenderId)

    expect(result.advancedTenderIds).toEqual([tenderId])
    expect(messages).toHaveLength(2)
    const view = JSON.parse(messages[1]).view
    expect(view.phase).not.toBe('access-slot-selection')
  })

  test('synchronises an externally advanced Tender without a local change callback', async () => {
    let now = new Date('2026-07-21T12:00:00Z')
    const store = createInMemoryTenderStore()
    const apiTender = createTenderModule({ now: () => now, store })
    const workerTender = createTenderModule({ now: () => now, store })
    const { tenderId } = await apiTender.createTender({ players })
    const hub = createRealtimeHub({ tender: apiTender })
    const first = collectSocket()
    const second = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: first.socket, tenderId })
    await hub.subscribe({ playerId: 'player-b', socket: second.socket, tenderId })

    now = new Date(now.getTime() + 90_000)
    expect(await workerTender.advanceDueTenders({ limit: 10, now })).toEqual({ advancedTenderIds: [tenderId] })

    await hub.syncActiveTenders()

    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(2)
    const firstView = JSON.parse(first.messages[1]).view
    const secondView = JSON.parse(second.messages[1]).view
    expect(firstView).toMatchObject({
      dueAt: '2026-07-21T12:03:00.000Z',
      phase: 'power-allocation',
      round: 1,
      serverTime: '2026-07-21T12:01:30.000Z',
    })
    expect(secondView).toMatchObject({
      dueAt: firstView.dueAt,
      phase: firstView.phase,
      round: firstView.round,
      serverTime: firstView.serverTime,
    })
  })

  test('does not resend an unchanged Tender view during periodic synchronisation', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const subscriber = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: subscriber.socket, tenderId })

    await hub.syncActiveTenders()

    expect(subscriber.messages).toHaveLength(1)
  })

  test('never delivers an older Tender view after a concurrent newer synchronisation', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let delayNextRead = false
    let markDelayedReadStarted: () => void = () => undefined
    const delayedReadStarted = new Promise<void>((resolve) => {
      markDelayedReadStarted = resolve
    })
    let releaseDelayedRead: () => void = () => undefined
    const delayedReadReleased = new Promise<void>((resolve) => {
      releaseDelayedRead = resolve
    })
    const tender = {
      ...baseTender,
      async readTenderView(input: Parameters<typeof baseTender.readTenderView>[0]) {
        const view = await baseTender.readTenderView(input)
        if (delayNextRead) {
          delayNextRead = false
          markDelayedReadStarted()
          await delayedReadReleased
        }
        return view
      },
    }
    const hub = createRealtimeHub({ tender })
    const subscriber = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: subscriber.socket, tenderId })
    await baseTender.execute({
      actorId: 'player-a',
      commandId: 'concurrent-version-1',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    delayNextRead = true

    const delayedPublish = hub.handleTenderChanged(tenderId)
    await delayedReadStarted
    await baseTender.execute({
      actorId: 'player-b',
      commandId: 'concurrent-version-2',
      slot: 2,
      tenderId,
      type: 'request-access-slot',
    })
    await hub.syncActiveTenders()
    releaseDelayedRead()
    await delayedPublish

    expect(subscriber.messages.map((message) => JSON.parse(message).view.version))
      .toEqual([0, 2])
  })

  test.each([
    {
      name: 'local publish',
      notify: (hub: ReturnType<typeof createRealtimeHub>, tenderId: string) => hub.handleTenderChanged(tenderId),
    },
    {
      name: 'periodic synchronisation',
      notify: (hub: ReturnType<typeof createRealtimeHub>, _tenderId: string) => hub.syncActiveTenders(),
    },
  ])('closes a failed $name subscription for retry while other subscribers keep receiving updates', async ({ notify }) => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let failPlayerARead = false
    const tender = {
      ...baseTender,
      async readTenderView(input: Parameters<typeof baseTender.readTenderView>[0]) {
        if (failPlayerARead && input.playerId === 'player-a') {
          throw new Error('transient database read failure')
        }
        return baseTender.readTenderView(input)
      },
    }
    const hub = createRealtimeHub({ tender })
    const failed = collectSocket()
    const healthy = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: failed.socket, tenderId })
    await hub.subscribe({ playerId: 'player-b', socket: healthy.socket, tenderId })

    await baseTender.execute({
      actorId: 'player-a',
      commandId: 'command-player-a',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    failPlayerARead = true
    await notify(hub, tenderId)

    expect(failed.closeEvents).toEqual([{ code: 1011, reason: 'Internal error' }])
    expect(healthy.closeEvents).toEqual([])
    expect(healthy.messages).toHaveLength(2)

    await baseTender.execute({
      actorId: 'player-b',
      commandId: 'command-player-b',
      slot: 2,
      tenderId,
      type: 'request-access-slot',
    })
    await notify(hub, tenderId)

    expect(failed.closeEvents).toHaveLength(1)
    expect(healthy.closeEvents).toEqual([])
    expect(healthy.messages).toHaveLength(3)
  })

  test.each([
    'tender_not_found',
    'player_not_in_tender',
    'player_forfeited',
  ] as const)('closes concurrent established %s once without reporting an error', async (kind) => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await exerciseConcurrentFailedReads(
        new TenderFailure(kind, 'private failure detail'),
      )

      expect(result.failedReads).toBe(2)
      expect(result.failed.closeEvents).toEqual([{ code: 4404, reason: 'Unavailable' }])
      expect(result.healthy.closeEvents).toEqual([])
      expect(result.healthy.messages.length).toBeGreaterThanOrEqual(2)
      expect(consoleError).not.toHaveBeenCalled()

      await result.hub.handleTenderChanged(result.tenderId)
      expect(result.failed.closeEvents).toHaveLength(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  test('closes and reports a concurrent established operational failure once', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
    const operationalFailure = new Error('transient database read failure')
    try {
      const result = await exerciseConcurrentFailedReads(operationalFailure)

      expect(result.failedReads).toBe(2)
      expect(result.failed.closeEvents).toEqual([{ code: 1011, reason: 'Internal error' }])
      expect(result.healthy.closeEvents).toEqual([])
      expect(result.healthy.messages.length).toBeGreaterThanOrEqual(2)
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(consoleError.mock.calls[0]?.[1]).toBe(operationalFailure)

      await result.hub.handleTenderChanged(result.tenderId)
      expect(result.failed.closeEvents).toHaveLength(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  test('waits for an active synchronisation before the sync loop stops', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let blockSynchronisation = false
    let releaseSynchronisation = () => {}
    const synchronisationReleased = new Promise<void>((resolve) => {
      releaseSynchronisation = resolve
    })
    let markSynchronisationStarted = () => {}
    const synchronisationStarted = new Promise<void>((resolve) => {
      markSynchronisationStarted = resolve
    })
    const tender = {
      ...baseTender,
      async readTenderView(input: Parameters<typeof baseTender.readTenderView>[0]) {
        if (blockSynchronisation) {
          markSynchronisationStarted()
          await synchronisationReleased
        }
        return baseTender.readTenderView(input)
      },
    }
    const hub = createRealtimeHub({ tender })
    const { socket } = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket, tenderId })
    blockSynchronisation = true

    const stopSyncLoop = hub.startSyncLoop(1)
    await synchronisationStarted
    let stopped = false
    const stopping = stopSyncLoop().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(stopped).toBe(false)
    releaseSynchronisation()
    await stopping
    expect(stopped).toBe(true)
    await expect(stopSyncLoop()).resolves.toBeUndefined()
  })

  test('stops notifying an unsubscribed socket', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    const { messages, socket } = collectSocket()
    const subscription = await hub.subscribe({ playerId: 'player-a', socket, tenderId })

    await subscription.close()
    await hub.handleTenderChanged(tenderId)

    expect(messages).toHaveLength(1)
  })

  test('never delivers a pending Tender view after the subscription closes', async () => {
    const baseTender = createTenderModule()
    const { tenderId } = await baseTender.createTender({ players })
    let blockNextRead = false
    let markReadStarted: () => void = () => undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    let releaseRead: () => void = () => undefined
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const tender = {
      ...baseTender,
      async readTenderView(input: Parameters<typeof baseTender.readTenderView>[0]) {
        const view = await baseTender.readTenderView(input)
        if (blockNextRead) {
          blockNextRead = false
          markReadStarted()
          await readReleased
        }
        return view
      },
    }
    const hub = createRealtimeHub({ tender })
    const subscriber = collectSocket()
    const subscription = await hub.subscribe({ playerId: 'player-a', socket: subscriber.socket, tenderId })
    await baseTender.execute({
      actorId: 'player-a',
      commandId: 'pending-after-close',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })
    blockNextRead = true

    const publishing = hub.handleTenderChanged(tenderId)
    await readStarted
    await subscription.close()
    releaseRead()
    await publishing

    expect(subscriber.messages).toHaveLength(1)
  })

  test('isolates a failed socket without blocking healthy subscribers', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })
    let brokenSendAttempts = 0
    const brokenSocket: RealtimeSocket = {
      close: () => undefined,
      send: () => {
        brokenSendAttempts += 1
        throw new Error('socket closed during send')
      },
    }
    await expect(hub.subscribe({
      playerId: 'player-a',
      socket: brokenSocket,
      tenderId,
    })).rejects.toThrow('socket closed during send')

    const healthy = collectSocket()
    await hub.subscribe({ playerId: 'player-b', socket: healthy.socket, tenderId })

    await tender.execute({
      actorId: 'player-b',
      commandId: 'healthy-after-broken-socket',
      slot: 2,
      tenderId,
      type: 'request-access-slot',
    })

    await expect(hub.handleTenderChanged(tenderId)).resolves.toBeUndefined()
    expect(brokenSendAttempts).toBe(1)
    expect(healthy.messages).toHaveLength(2)
  })

  test('exposes tender changes to an external publisher', async () => {
    const changed: string[] = []
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({
      onTenderChanged: (changedTenderId) => { changed.push(changedTenderId) },
      tender,
    })

    hub.tenderChanged(tenderId)

    expect(changed).toEqual([tenderId])
  })

  test('reconnecting subscriber receives the current state after a timeout', async () => {
    let now = new Date('2026-07-21T12:00:00Z')
    const tender = createTenderModule({ now: () => now })
    const { tenderId } = await tender.createTender({ players })
    const hub = createRealtimeHub({ tender })

    // First connection — subscribe player-a
    const first = collectSocket()
    const sub1 = await hub.subscribe({ playerId: 'player-a', socket: first.socket, tenderId })
    expect(JSON.parse(first.messages[0]).view.phase).toBe('access-slot-selection')

    // Disconnect
    await sub1.close()

    // Timeout resolves — deadline passes, tender advances
    now = new Date('2026-07-21T12:01:30Z')
    const result = await tender.advanceDueTenders({ limit: 10, now })
    expect(result.advancedTenderIds).toContain(tenderId)
    await hub.handleTenderChanged(tenderId)

    // Reconnect
    const second = collectSocket()
    await hub.subscribe({ playerId: 'player-a', socket: second.socket, tenderId })

    // Should receive the current (advanced) state
    expect(second.messages).toHaveLength(1)
    const view = JSON.parse(second.messages[0]).view
    expect(view.tenderId).toBe(tenderId)
    // Phase should have moved past access-slot-selection
    expect(view.phase).not.toBe('access-slot-selection')
  })
})
