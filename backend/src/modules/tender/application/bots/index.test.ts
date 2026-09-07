import { describe, expect, test } from 'bun:test'
import type { SignalId } from '@anomaly-detector/contracts'

import { createTenderModule } from '../../index'
import { chooseBotCommand } from './index'

describe('chooseBotCommand', () => {
  test('never requests a priced Access Slot when its projected Budget is zero', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'human', tiePriority: 1 },
        { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
      ],
    })
    const view = await tender.readTenderView({ playerId: 'bot', tenderId })
    const zeroBudgetView = {
      ...view,
      players: view.players.map((player) => player.playerId === 'bot' ? { ...player, budget: 0 } : player),
    }

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const command = chooseBotCommand(zeroBudgetView, {
        commandId: `zero-budget-${seed}`,
        difficulty: 'easy',
        playerId: 'bot',
        seed,
      })
      expect(command).toMatchObject({ type: 'request-access-slot' })
      if (command?.type === 'request-access-slot') expect(command.slot).toBeGreaterThanOrEqual(3)
    }
  })

  test('does not issue a command for a departed participant', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'bot-a', tiePriority: 1 },
        { id: 'bot-b', tiePriority: 2 },
      ],
    })
    await tender.execute({ actorId: 'bot-a', commandId: 'leave', tenderId, type: 'leave-tender' })
    const view = await tender.readTenderView({ playerId: 'bot-a', tenderId })

    expect(chooseBotCommand(view, {
      commandId: 'after-leave',
      difficulty: 'easy',
      playerId: 'bot-a',
      seed: 'bot-policy-seed',
    })).toBeNull()
  })

  test('keeps reconnaissance legal after every Signal is public and can still submit a final model without Samples', async () => {
    const tender = createTenderModule()
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'human', tiePriority: 1 },
        { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
      ],
    })
    const view = await tender.readTenderView({ playerId: 'bot', tenderId })
    const botPower = { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 1, reserve: 3 }
    const allSignals: SignalId[] = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro']
    const collectedSignals: SignalId[] = ['aster', 'boreal', 'cinder', 'delta', 'eclipse']
    const reconnaissanceView = {
      ...view,
      activePlayerId: 'bot',
      knownSignals: allSignals,
      phase: 'reconnaissance' as const,
      players: view.players.map((player) => player.playerId === 'bot'
        ? { ...player, powerAllocation: botPower }
        : player),
      privateSamples: collectedSignals,
    }
    const reconnaissance = chooseBotCommand(reconnaissanceView, {
      commandId: 'all-known-recon',
      difficulty: 'easy',
      playerId: 'bot',
      seed: 'bot-policy-seed',
    })
    expect(reconnaissance).toMatchObject({ targets: ['ferro'], type: 'conduct-reconnaissance' })

    const final = chooseBotCommand({
      ...view,
      knownSignals: ['aster'] as SignalId[],
      phase: 'final-scientific-model',
      privateSamples: [],
    }, {
      commandId: 'no-sample-final',
      difficulty: 'easy',
      playerId: 'bot',
      seed: 'bot-policy-seed',
    })
    expect(final).toMatchObject({
      scientificModel: { signals: { aster: expect.any(Object) } },
      type: 'submit-scientific-model',
    })
  })

  test('drives participant projections through five rounds without using hidden Tender state', async () => {
    const tender = createTenderModule({ seedGenerator: () => 'bot-policy-test-seed' })
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'bot-a', tiePriority: 1 },
        { id: 'bot-b', tiePriority: 2 },
      ],
    })

    const commandTypes = new Set<string>()
    for (let step = 0; step < 160; step += 1) {
      const views = await Promise.all(['bot-a', 'bot-b'].map(async (playerId) => ({
        playerId,
        view: await tender.readTenderView({ playerId, tenderId }),
      })))
      if (views.every(({ view }) => view.phase === 'complete')) break

      let executed = false
      for (const { playerId, view } of views) {
        const command = chooseBotCommand(view, {
          commandId: `bot-policy-${step}-${playerId}`,
          difficulty: 'easy',
          playerId,
          seed: 'bot-policy-seed',
        })
        if (!command) continue
        commandTypes.add(command.type)
        await tender.execute(command)
        executed = true
        break
      }
      expect(executed).toBe(true)
    }

    const completed = await tender.readTenderView({ playerId: 'bot-a', tenderId })
    expect(completed.phase).toBe('complete')
    expect([...commandTypes]).toEqual(expect.arrayContaining([
      'request-access-slot',
      'allocate-power',
      'conduct-reconnaissance',
      'run-laboratory-test',
      'submit-thesis',
      'skip-contract',
      'submit-scientific-model',
    ]))
  })

  test('completes bounded multi-seed games with one stored bot and one human autopolicy', async () => {
    for (let index = 0; index < 20; index += 1) {
      const seed = `bot-policy-seed-${index}`
      const tender = createTenderModule({ seedGenerator: () => seed })
      const { tenderId } = await tender.createTender({
        players: [
          { id: 'human', tiePriority: 1 },
          { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
        ],
      })

      for (let step = 0; step < 160; step += 1) {
        const views = await Promise.all(['human', 'bot'].map(async (playerId) => ({
          playerId,
          view: await tender.readTenderView({ playerId, tenderId }),
        })))
        if (views.every(({ view }) => view.phase === 'complete')) break

        const candidate = views.map(({ playerId, view }) => chooseBotCommand(view, {
          commandId: `multi-${index}-${step}-${playerId}`,
          difficulty: 'easy',
          playerId,
          seed: `${seed}:${playerId}`,
        })).find((command) => command !== null)
        expect(candidate).not.toBeNull()
        await tender.execute(candidate!)
      }

      expect((await tender.readTenderView({ playerId: 'bot', tenderId })).phase).toBe('complete')
    }
  })
})
