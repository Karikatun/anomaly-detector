import { describe, expect, test } from 'bun:test'

import { createTenderModule } from '../index'
import { createRealtimeHub, type RealtimeSocket } from './hub'

const players = [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }]

const collectSocket = () => {
  const messages: string[] = []
  const socket: RealtimeSocket = {
    send: (message) => { messages.push(message) },
  }
  return { messages, socket }
}

describe('realtime hub', () => {
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

    now = new Date(now.getTime() + 60_000)
    const result = await tender.advanceDueTenders({ limit: 10, now })
    await hub.handleTenderChanged(tenderId)

    expect(result.advancedTenderIds).toEqual([tenderId])
    expect(messages).toHaveLength(2)
    const view = JSON.parse(messages[1]).view
    expect(view.phase).not.toBe('access-slot-selection')
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
    now = new Date('2026-07-21T12:01:00Z')
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
