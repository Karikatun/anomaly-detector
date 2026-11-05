import { expect, test } from 'bun:test'
import { simpleMatrix, assertSimpleMatrix, summarizeSimple, simpleReplayFingerprint, emptySimplePlayerDiagnostics, simulateSimple, type SimpleCaseResult } from './simple-bot-benchmark'

test('simple holdout requires exactly 216 main and 72 matched controls without duplicates', () => {
  const cases = simpleMatrix('holdout')
  expect(cases).toHaveLength(288)
  expect(cases.filter((item) => item.composition === 'control')).toHaveLength(72)
  expect(() => assertSimpleMatrix(cases, 'holdout')).not.toThrow()
  expect(() => assertSimpleMatrix(cases.slice(1), 'holdout')).toThrow()
  expect(() => assertSimpleMatrix([...cases, cases[0]!], 'holdout')).toThrow()
})

test('simple evaluation clusters rotations within seeds and never accepts missing replay evidence', () => {
  const results = simpleMatrix('holdout').map((input): SimpleCaseResult => ({ input,
    traceHash: 'same-accepted-observations-and-receipts', hash: '', commands: 1, timeouts: 0, invalidCommands: 0, maxDecisionMs: 1,
    players: Array.from({ length: input.players }, (_, seat) => ({ ...emptySimplePlayerDiagnostics(), actor: (seat + input.rotation) % input.players,
      seat, score: input.composition === 'control' && (seat + input.rotation) % input.players === 0 ? 5 : 9,
      budget: 2, samples: 6, candidates: 1, provenProperties: 12, wastedPower: 0, laboratoryTests: 2,
      won: seat === input.rotation % input.players })), tieBreak: 'submission-order',
  }))
  for (const result of results) result.hash = result.replayHash = simpleReplayFingerprint(result)
  const summary = summarizeSimple(results, 'holdout')
  expect(summary.byPlayers[2]!.seedBlocks).toBe(8)
  expect(summary.byPlayers[2]!.researchDelta.mean).toBe(4)
  expect(summary.byPlayers[3]!.hardEasyDelta.mean).toBe(0)
  expect(summary.gates.replay).toBe(true)
  results[0]!.replayHash = 'different'
  expect(summarizeSimple(results, 'holdout').gates.replay).toBe(false)
})

test('persistent expanded win bias requires analysis even when every numeric threshold passes', () => {
  const results = simpleMatrix('expanded').map((input): SimpleCaseResult => ({ input,
    traceHash: 'identical-accepted-replay', hash: '', commands: 1, timeouts: 0, invalidCommands: 0, maxDecisionMs: 1,
    players: Array.from({ length: input.players }, (_, seat) => ({ ...emptySimplePlayerDiagnostics(), actor: (seat + input.rotation) % input.players,
      seat, score: input.composition === 'control' && (seat + input.rotation) % input.players === 0 ? 5 : 9,
      budget: 2, samples: 6, candidates: 1, provenProperties: 12, wastedPower: 0, laboratoryTests: 2, won: seat === 0 })),
    tieBreak: 'submission-order',
  }))
  for (const result of results) result.hash = result.replayHash = simpleReplayFingerprint(result)
  const summary = summarizeSimple(results, 'expanded')
  expect(summary.numericAccepted).toBe(true)
  expect(summary.diagnosticUnresolved).toBe(true)
  expect(summary.accepted).toBe(false)
  expect(summary.status).toBe('NEEDS_ANALYSIS')
})

test('replay binds observations, receipts and every deterministic evaluation metric despite equal commands and scores', () => {
  const result: SimpleCaseResult = { input: simpleMatrix('pilot')[0]!, traceHash: 'same-commands-different-observations',
    hash: '', commands: 4, timeouts: 0, invalidCommands: 0, maxDecisionMs: 1, tieBreak: 'accuracy',
    players: [{ ...emptySimplePlayerDiagnostics(), actor: 0, seat: 0, score: 8, budget: 2, samples: 4, candidates: 6, provenProperties: 3,
      wastedPower: 1, laboratoryTests: 2, won: true }] }
  const first = simpleReplayFingerprint(result)
  expect(simpleReplayFingerprint({ ...result, traceHash: 'different-research-result-or-accepted-receipt' })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, players: [{ ...result.players[0]!, candidates: 5 }] })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, players: [{ ...result.players[0]!, provenProperties: 4 }] })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, players: [{ ...result.players[0]!, samples: 5 }] })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, players: [{ ...result.players[0]!, wastedPower: 2 }] })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, players: [{ ...result.players[0]!, laboratoryTests: 3 }] })).not.toBe(first)
  expect(simpleReplayFingerprint({ ...result, maxDecisionMs: 9 })).toBe(first)
})

test('trajectory diagnostics distinguish research value, new pairs, blocked direct access and accepted free slots', async () => {
  const result = await simulateSimple({ ...simpleMatrix('pilot')[0]!, players: 4 })
  expect(result.timeouts).toBe(0)
  expect(result.invalidCommands).toBe(0)
  for (const player of result.players) {
    expect(player.accessByRound).toHaveLength(3)
    expect(player.newDirectedPairs).toBe(player.laboratoryTests)
    expect(player.repeatedDirectedPairs).toBe(0)
    expect(player.directedPairCoverage).toBe(player.newDirectedPairs / 30)
    expect(player.informationReducingLaboratoryActions).toBeGreaterThan(0)
    expect(player.informationReducingTheses).toBeGreaterThan(0)
    expect(player.informationReducingLaboratoryActions).toBeLessThanOrEqual(player.laboratoryTests)
    expect(player.directPoolUnavailableAtRecon).toBeGreaterThanOrEqual(0)
    for (const round of player.accessByRound) {
      expect(round.assignedSlot).toBeGreaterThanOrEqual(3)
      expect(round.paidSlot).toBe(false)
      expect(round.samplesAfterRecon).toBeGreaterThanOrEqual(round.samplesBeforeAllocation)
      expect(round.samplesAfterRecon).toBeLessThanOrEqual(6)
    }
    const altered = { ...result, players: result.players.map((item) => item.actor === player.actor
      ? { ...item, newDirectedPairs: item.newDirectedPairs + 1 } : item) }
    expect(simpleReplayFingerprint(altered)).not.toBe(result.hash)
  }
})
