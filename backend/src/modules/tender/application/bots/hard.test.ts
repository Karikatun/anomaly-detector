import { expect, test } from 'bun:test'

import { createTenderModule } from '../../index'
import { candidatesFromView } from './candidates'
import { chooseHardFinalModel, chooseHardThesis, expectedFinalModelRating, summarizePairedRatings } from './hard'
import { chooseBotCommand } from './index'

test('hard final-model scoring includes property, completed-signal, and complete-model points', () => {
  const candidates = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] }).slice(0, 2)
  const first = chooseHardFinalModel(candidates, 'hard-final')
  const expected = expectedFinalModelRating(candidates, first)

  expect(expected).toBe(17.5)
  expect(first).toEqual({ signals: candidates[0] })
})

test('hard final-model selection is deterministic for an unchanged participant posterior', () => {
  const candidates = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] }).slice(0, 3)

  expect(chooseHardFinalModel(candidates, 'hard-repeat')).toEqual(chooseHardFinalModel(candidates, 'hard-repeat'))
})

test('hard final-model decision remains defined for contradictory participant evidence and the fixed 720-model posterior', () => {
  const candidates = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] })

  expect(candidates).toHaveLength(720)
  expect(chooseHardFinalModel([], 'contradiction')).toEqual({ signals: {} })
  expect(chooseHardFinalModel(candidates, 'bounded-posterior')).toEqual(chooseHardFinalModel(candidates, 'bounded-posterior'))
})

test('hard policy preserves budget and contract eligibility boundaries', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const options = {
    commandId: 'hard-edge', difficulty: 'hard' as const, playerId: 'bot', seed: 'hard-edge', strategyVersion: 'bot-v2' as const,
  }

  expect(chooseBotCommand({
    ...view,
    players: view.players.map((player) => player.playerId === 'bot' ? { ...player, budget: 0 } : player),
  }, options)).toMatchObject({ slot: 3, type: 'request-access-slot' })

  expect(chooseBotCommand({ ...view, phase: 'power-allocation' }, options)).toMatchObject({
    allocation: { laboratory: 1, modelAnalysis: 1, reconnaissance: 2, reserve: 0 },
    type: 'allocate-power',
  })

  const unavailableContracts = view.publicContracts.map((contract) => ({
    ...contract,
    planning: { ...contract.planning!, eligible: false, missingConditions: ['evidence_used' as const] },
  }))
  const unavailable = chooseBotCommand({
    ...view,
    activePlayerId: 'bot',
    phase: 'contracts',
    publicContracts: unavailableContracts,
    publicFinalContract: view.publicFinalContract
      ? { ...view.publicFinalContract, planning: { ...view.publicFinalContract.planning!, eligible: false, missingConditions: ['corporate_trust' as const] } }
      : undefined,
  }, options)
  expect(unavailable).toMatchObject({ type: 'skip-contract' })

  expect(chooseBotCommand({
    ...view,
    activePlayerId: 'bot',
    phase: 'contracts',
    publicContracts: view.publicContracts.map((contract) => ({ ...contract, reservedByPlayerId: 'human' })),
  }, options)).toMatchObject({ type: 'skip-contract' })

  const rankedContracts = view.publicContracts.map((contract, index) => ({
    ...contract,
    contractId: `eligible-${index}`,
    ratingReward: index === 0 ? 2 : 5,
    planning: { ...contract.planning!, eligible: true, missingConditions: [] },
  }))
  expect(chooseBotCommand({
    ...view,
    activePlayerId: 'bot',
    phase: 'contracts',
    publicContracts: rankedContracts,
  }, options)).toMatchObject({ contractId: 'eligible-1', type: 'reserve-contract' })

  expect(chooseBotCommand({ ...view, hasForfeited: true }, options)).toBeNull()
})

test('hard thesis converts the most likely uncertified result into rating and certification value', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'bot', tiePriority: 1 }, { id: 'human', tiePriority: 2 }] })
  const view = await tender.readTenderView({ playerId: 'bot', tenderId })
  const candidates = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] })
  const likely = candidates[0]
  const alternative = candidates.at(-1)
  const posterior = [likely!, likely!, likely!, likely!, alternative!]

  const thesis = chooseHardThesis(view, 'bot', posterior, [])!
  expect(posterior.filter((candidate) => candidate[thesis.signalId].fieldType === thesis.fieldType
    && candidate[thesis.signalId].polarity === thesis.polarity)).toHaveLength(4)
})

const playPairedGame = async (difficulty: 'easy' | 'hard', seed: string, botTiePriority: 1 | 2) => {
  let now = new Date('2026-09-07T00:00:00.000Z')
  const tender = createTenderModule({ now: () => now, seedGenerator: () => seed })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'bot', tiePriority: botTiePriority, bot: { difficulty, strategyVersion: 'bot-v2' } },
      { id: 'human', tiePriority: botTiePriority === 1 ? 2 : 1 },
    ],
  })
  for (let step = 0; step < 220; step += 1) {
    const views = await Promise.all(['bot', 'human'].map(async (playerId) => ({
      playerId,
      view: await tender.readTenderView({ playerId, tenderId }),
    })))
    if (views.every(({ view }) => view.phase === 'complete')) break
    const command = views.map(({ playerId, view }) => chooseBotCommand(view, {
      commandId: `hard-${seed}-${botTiePriority}-${difficulty}-${step}-${playerId}`,
      difficulty: playerId === 'bot' ? difficulty : 'easy',
      playerId,
      seed: `${seed}:${playerId}`,
      strategyVersion: playerId === 'bot' ? 'bot-v2' : 'bot-v1',
    })).find((candidate) => candidate !== null)
    if (command) await tender.execute(command)
    else {
      now = new Date(now.getTime() + 120_000)
      await tender.advanceDueTenders({ limit: 10, now })
    }
  }
  const completed = await tender.readTenderView({ playerId: 'bot', tenderId })
  expect(completed.phase).toBe('complete')
  return completed.players.find((player) => player.playerId === 'bot')!.rating
}

test('hard beats easy over 20 fixed configurations with both seat priorities', async () => {
  const deltas: number[] = []
  for (let index = 0; index < 20; index += 1) {
    for (const botTiePriority of [1, 2] as const) {
      const seed = `hard-paired-${index}`
      const easy = await playPairedGame('easy', seed, botTiePriority)
      const hard = await playPairedGame('hard', seed, botTiePriority)
      deltas.push(hard - easy)
    }
  }
  const summary = summarizePairedRatings(deltas)
  expect(summary.sampleSize).toBe(40)
  expect(summary.meanDelta).toBeCloseTo(8.625, 8)
  expect(summary.standardError).toBeCloseTo(0.2834935444, 8)
  expect(summary.wins).toBe(40)
  expect(summary.losses).toBe(0)
})
