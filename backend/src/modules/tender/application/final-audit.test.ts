import { expect, test } from 'bun:test'

import { decodeTenderAuditEvent } from './tender-audit-event'
import { createRatingBreakdownByPlayer } from './final-audit'
import type { StoredTender } from './tender-store'

test('uses the authoritative v2 certification count for legacy Thesis events without ratingAward', () => {
  const tender = {
    budgetByPlayer: { 'player-a': 2 },
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    corporateTrustByPlayer: { 'player-a': 0 },
    forfeitedAtByPlayer: {},
    players: [{ id: 'player-a', tiePriority: 1 }],
    publicTheses: [],
    ratingByPlayer: { 'player-a': 1 },
    ruleset: 'tender-v2',
  } as unknown as StoredTender
  const legacyEvent = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'private_thesis_checked',
    payload: {
      fieldTypeCorrect: true,
      fullyCorrect: true,
      playerId: 'player-a',
      polarityCorrect: true,
      signalId: 'aster',
      thesisId: 'legacy-thesis-a',
    },
    sequence: 1,
  })

  expect(createRatingBreakdownByPlayer(tender, [legacyEvent])['player-a']).toMatchObject({
    otherPoints: 0,
    thesisPoints: 1,
    total: 1,
  })
})

test('keeps the v1 correct-Thesis count aligned with its rating breakdown', () => {
  const tender = {
    budgetByPlayer: { 'player-a': 2 },
    certifiedSignalsByPlayer: {},
    corporateTrustByPlayer: { 'player-a': 0 },
    forfeitedAtByPlayer: {},
    players: [{ id: 'player-a', tiePriority: 1 }],
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'positive',
      signalId: 'aster',
      verification: 'standard',
    }],
    ratingByPlayer: { 'player-a': 1 },
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const event = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'thesis_checked',
    payload: { correct: true, playerId: 'player-a', signalId: 'aster' },
    sequence: 1,
  })

  expect(createRatingBreakdownByPlayer(tender, [event])['player-a']).toMatchObject({
    otherPoints: 0,
    thesisPoints: 1,
    total: 1,
  })
})

test('counts one current v2 certification when a repeated correct Thesis earns no second award', () => {
  const tender = {
    budgetByPlayer: { 'player-a': 2 },
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    corporateTrustByPlayer: { 'player-a': 0 },
    forfeitedAtByPlayer: {},
    players: [{ id: 'player-a', tiePriority: 1 }],
    publicTheses: [],
    ratingByPlayer: { 'player-a': 1 },
    ruleset: 'tender-v2',
  } as unknown as StoredTender
  const event = (sequence: number, ratingAward: number) => decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'private_thesis_checked',
    payload: {
      data: {
        fieldTypeCorrect: true,
        fullyCorrect: true,
        playerId: 'player-a',
        polarityCorrect: true,
        ratingAward,
        signalId: 'aster',
        thesisId: `current-thesis-${sequence}`,
      },
      formatVersion: 1,
    },
    sequence,
  })

  expect(createRatingBreakdownByPlayer(tender, [event(1, 1), event(2, 0)])['player-a'])
    .toMatchObject({
      otherPoints: 0,
      thesisPoints: 1,
      total: 1,
    })
})
