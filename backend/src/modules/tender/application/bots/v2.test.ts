import { expect, test } from 'bun:test'
import type { SignalId } from '@anomaly-detector/contracts'

import { createTenderModule } from '../../index'
import { candidateConsensus, candidatesFromView } from './candidates'
import { chooseBotCommand } from './index'

test('bot-v2 chooses the known highest-information broad observation from the same participant view', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const laboratoryView = {
    ...view,
    activePlayerId: 'bot',
    phase: 'laboratory' as const,
    players: view.players.map((player) => player.playerId === 'bot'
      ? { ...player, powerAllocation: { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 0, reserve: 2 } }
      : player),
    privateSamples: ['aster', 'boreal', 'cinder'] as SignalId[],
  }
  const options = {
    commandId: 'v2-broad',
    difficulty: 'easy' as const,
    playerId: 'bot',
    seed: 'v2-literal-seed',
    strategyVersion: 'bot-v2' as const,
  }

  const command = chooseBotCommand(laboratoryView, options)

  expect(command).toMatchObject({
    laboratory: {
      mode: 'broad',
      pairs: [
        { receiverSignal: 'cinder', sourceSignal: 'boreal' },
        { receiverSignal: 'aster', sourceSignal: 'cinder' },
      ],
    },
    type: 'run-laboratory-test',
  })
  expect(chooseBotCommand(laboratoryView, options)).toEqual(command)
})

test('bot-v2 retains bot-v1 decisions unless an inference action applies', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const base = { commandId: 'same-slot', difficulty: 'easy' as const, playerId: 'bot', seed: 'version-seed' }

  expect(chooseBotCommand(view, { ...base, strategyVersion: 'bot-v1' })).toEqual(chooseBotCommand(view, base))
  expect(chooseBotCommand(view, { ...base, strategyVersion: 'bot-v2' })).toEqual(chooseBotCommand(view, base))
})

test('bot-v2 finishes a corporate-review analysis it cannot afford instead of repeating working-model updates', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const command = chooseBotCommand({
    ...view,
    corporateReviewActive: true,
    phase: 'model-analysis',
    players: view.players.map((player) => player.playerId === 'bot'
      ? {
          ...player,
          budget: 0,
          modelAnalysisCompleted: false,
          powerAllocation: { contracts: 0, laboratory: 0, modelAnalysis: 2, reconnaissance: 0, reserve: 2 },
        }
      : player),
    privateTheses: [{
      fieldType: 'inertial',
      fieldTypeCorrect: false,
      fullyCorrect: false,
      id: 'first-thesis',
      polarity: 'positive',
      polarityCorrect: false,
      round: 1,
      signalId: 'aster',
    }],
  }, {
    commandId: 'cannot-afford-analysis',
    difficulty: 'easy',
    playerId: 'bot',
    seed: 'v2-guard',
    strategyVersion: 'bot-v2',
  })

  expect(command).toMatchObject({ type: 'finish-model-analysis' })
})

test('bot-v2 normalises an empty Working Model and proceeds to an information thesis', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const command = chooseBotCommand({
    ...view,
    phase: 'model-analysis',
    players: view.players.map((player) => player.playerId === 'bot'
      ? { ...player, modelAnalysisCompleted: false, powerAllocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 3 } }
      : player),
    privateWorkingModel: { signals: {} },
  }, {
    commandId: 'normalised-working-model',
    difficulty: 'easy',
    playerId: 'bot',
    seed: 'v2-normalise',
    strategyVersion: 'bot-v2',
  })

  expect(command).toMatchObject({ type: 'submit-thesis' })
})

test('bot-v2 does not fabricate a final model when participant evidence has no consensus', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })

  expect(chooseBotCommand({ ...view, phase: 'final-scientific-model' }, {
    commandId: 'no-consensus-final',
    difficulty: 'easy',
    playerId: 'bot',
    seed: 'v2-no-certainty',
    strategyVersion: 'bot-v2',
  })).toBeNull()
})

test('bot-v2 reaches a measured full-configuration baseline across fixed hidden-config holdouts', async () => {
  const candidateCounts: number[] = []
  for (let index = 0; index < 5; index += 1) {
    let now = new Date('2026-09-07T00:00:00.000Z')
    const tender = createTenderModule({ now: () => now, seedGenerator: () => `v2-holdout-${index}` })
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'bot', tiePriority: 1, bot: { difficulty: 'easy', strategyVersion: 'bot-v2' } },
        { id: 'human', tiePriority: 2 },
      ],
    })
    for (let step = 0; step < 220; step += 1) {
      const views = await Promise.all(['bot', 'human'].map(async (playerId) => ({
        playerId,
        view: await tender.readTenderView({ playerId, tenderId }),
      })))
      if (views.every(({ view }) => view.phase === 'complete')) break
      const command = views.map(({ playerId, view }) => chooseBotCommand(view, {
        commandId: `v2-${index}-${step}-${playerId}`,
        difficulty: 'easy',
        playerId,
        seed: `v2-holdout:${playerId}`,
        strategyVersion: playerId === 'bot' ? 'bot-v2' : 'bot-v1',
      })).find((candidate) => candidate !== null)
      if (command) {
        await tender.execute(command)
      } else {
        now = new Date(now.getTime() + 120_000)
        await tender.advanceDueTenders({ limit: 10, now })
      }
    }
    const completed = await tender.readTenderView({ playerId: 'bot', tenderId })
    const candidates = candidatesFromView(completed)
    candidateCounts.push(candidates.length)
    expect(completed.phase).toBe('complete')
    expect(Object.values(candidateConsensus(candidates)).every((claim) => claim.fieldType && claim.polarity)).toBe(true)
    expect(completed.audit?.finalScientificModelsByPlayer.bot).toMatchObject({
      signals: expect.objectContaining({ aster: expect.objectContaining({ fieldTypeCorrect: true, polarityCorrect: true }) }),
      submitted: true,
    })
  }

  expect(candidateCounts).toEqual([1, 1, 1, 1, 1])
})
