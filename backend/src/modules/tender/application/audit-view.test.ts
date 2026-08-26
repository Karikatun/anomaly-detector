import { expect, test } from 'bun:test'

import { createParticipantAuditRounds } from './audit-view'
import { decodeTenderAuditEvent, TenderAuditEventDecodeError } from './tender-audit-event'
import type { StoredTender } from './tender-store'

const anomalyConfiguration = {
  seed: 'participant-audit-test',
  signals: {
    aster: { fieldType: 'inertial' as const, polarity: 'positive' as const },
    boreal: { fieldType: 'inertial' as const, polarity: 'negative' as const },
    cinder: { fieldType: 'electromagnetic' as const, polarity: 'positive' as const },
    delta: { fieldType: 'electromagnetic' as const, polarity: 'negative' as const },
    eclipse: { fieldType: 'phase' as const, polarity: 'positive' as const },
    ferro: { fieldType: 'phase' as const, polarity: 'negative' as const },
  },
}

const baseTender = {
  anomalyConfiguration,
  players: [{ id: 'player-a', tiePriority: 1 }],
  privateMeasurementsByPlayer: {},
  publicFinalContract: {},
  publicScientificJournal: [],
  round: 1,
}

test('restores a legacy v2 Thesis rating source from the authoritative private Thesis state', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    privateThesesByPlayer: {
      'player-a': [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: true,
        id: 'legacy-thesis-a',
        polarity: 'positive',
        polarityCorrect: true,
        round: 1,
        signalId: 'aster',
      }],
    },
    publicTheses: [],
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

  expect(createParticipantAuditRounds(tender, [legacyEvent])).toMatchObject([{
    ratingChanges: [{ playerId: 'player-a', points: 1, source: 'thesis' }],
    theses: [{ id: 'legacy-thesis-a', playerId: 'player-a' }],
  }])
})

test('restores a v1 public Thesis and its rating source in the owning round', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'positive',
      signalId: 'aster',
      verification: 'standard',
    }],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const event = decodeTenderAuditEvent({
    actorId: 'player-a',
    commandId: 'v1-thesis-command',
    kind: 'thesis_checked',
    payload: {
      data: { correct: true, playerId: 'player-a', signalId: 'aster' },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(createParticipantAuditRounds(tender, [event])).toMatchObject([{
    ratingChanges: [{ playerId: 'player-a', points: 1, source: 'thesis' }],
    theses: [{
      fieldType: 'inertial',
      fieldTypeCorrect: true,
      fullyCorrect: true,
      id: 'v1-thesis-command',
      playerId: 'player-a',
      polarity: 'positive',
      polarityCorrect: true,
      round: 1,
      signalId: 'aster',
    }],
  }])
})

test('keeps one v2 Thesis award when a later fully correct Thesis repeats the certified Signal', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    privateThesesByPlayer: {
      'player-a': [
        {
          fieldType: 'inertial',
          fieldTypeCorrect: true,
          fullyCorrect: true,
          id: 'current-thesis-a-1',
          polarity: 'positive',
          polarityCorrect: true,
          round: 1,
          signalId: 'aster',
        },
        {
          fieldType: 'inertial',
          fieldTypeCorrect: true,
          fullyCorrect: true,
          id: 'current-thesis-a-2',
          polarity: 'positive',
          polarityCorrect: true,
          round: 1,
          signalId: 'aster',
        },
      ],
    },
    publicTheses: [],
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
        thesisId: `current-thesis-a-${sequence}`,
      },
      formatVersion: 1,
    },
    sequence,
  })

  expect(createParticipantAuditRounds(tender, [event(1, 1), event(2, 0)])[0]?.ratingChanges)
    .toEqual([{ playerId: 'player-a', points: 1, source: 'thesis' }])
})

test('rejects a current v2 Thesis event that disagrees with the authoritative private state', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    privateThesesByPlayer: {
      'player-a': [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: true,
        id: 'state-thesis',
        polarity: 'positive',
        polarityCorrect: true,
        round: 1,
        signalId: 'aster',
      }],
    },
    publicTheses: [],
    ruleset: 'tender-v2',
  } as unknown as StoredTender
  const mismatchedEvent = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'private_thesis_checked',
    payload: {
      data: {
        fieldTypeCorrect: false,
        fullyCorrect: false,
        playerId: 'player-a',
        polarityCorrect: true,
        ratingAward: 0,
        signalId: 'boreal',
        thesisId: 'event-thesis',
      },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(() => createParticipantAuditRounds(tender, [mismatchedEvent]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
})

test('validates current v2 Thesis correctness against configuration and authenticated actor', () => {
  const tenderWithThesis = (fieldType: 'electromagnetic' | 'inertial') => ({
    ...baseTender,
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    privateThesesByPlayer: {
      'player-a': [{
        fieldType,
        fieldTypeCorrect: true,
        fullyCorrect: true,
        id: 'semantic-thesis',
        polarity: 'positive' as const,
        polarityCorrect: true,
        round: 1,
        signalId: 'aster' as const,
      }],
    },
    publicTheses: [],
    ruleset: 'tender-v2',
  }) as unknown as StoredTender
  const event = (actorId?: string) => decodeTenderAuditEvent({
    ...(actorId ? { actorId } : {}),
    commandId: 'semantic-thesis-command',
    kind: 'private_thesis_checked',
    payload: {
      data: {
        fieldTypeCorrect: true,
        fullyCorrect: true,
        playerId: 'player-a',
        polarityCorrect: true,
        ratingAward: 1,
        signalId: 'aster',
        thesisId: 'semantic-thesis',
      },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(() => createParticipantAuditRounds(tenderWithThesis('electromagnetic'), [event('player-a')]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(tenderWithThesis('inertial'), [event('player-b')]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(tenderWithThesis('inertial'), [event()]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))

  const legacyActorlessEvent = decodeTenderAuditEvent({
    kind: 'private_thesis_checked',
    payload: {
      fieldTypeCorrect: true,
      fullyCorrect: true,
      playerId: 'player-a',
      polarityCorrect: true,
      signalId: 'aster',
      thesisId: 'semantic-thesis',
    },
    sequence: 1,
  })
  expect(createParticipantAuditRounds(
    tenderWithThesis('inertial'),
    [legacyActorlessEvent],
  )[0]?.ratingChanges).toEqual([{ playerId: 'player-a', points: 1, source: 'thesis' }])
})

test('rejects wrong-award, missing and duplicate current v2 Thesis events', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: { 'player-a': ['aster'] },
    privateThesesByPlayer: {
      'player-a': [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: true,
        id: 'current-state-thesis',
        polarity: 'positive',
        polarityCorrect: true,
        round: 1,
        signalId: 'aster',
      }],
    },
    publicTheses: [],
    ruleset: 'tender-v2',
  } as unknown as StoredTender
  const wrongAward = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'private_thesis_checked',
    payload: {
      data: {
        fieldTypeCorrect: true,
        fullyCorrect: true,
        playerId: 'player-a',
        polarityCorrect: true,
        ratingAward: 0,
        signalId: 'aster',
        thesisId: 'current-state-thesis',
      },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(() => createParticipantAuditRounds(tender, [wrongAward]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(tender, []))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))

  const validAward = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'private_thesis_checked',
    payload: {
      data: {
        fieldTypeCorrect: true,
        fullyCorrect: true,
        playerId: 'player-a',
        polarityCorrect: true,
        ratingAward: 1,
        signalId: 'aster',
        thesisId: 'current-state-thesis',
      },
      formatVersion: 1,
    },
    sequence: 1,
  })
  expect(() => createParticipantAuditRounds(tender, [validAward, validAward]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
})

test('rejects aggregate outsider player ids with the owning event format classification', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicTheses: [],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const failureKind = (event: ReturnType<typeof decodeTenderAuditEvent>) => {
    try {
      createParticipantAuditRounds(tender, [event])
    } catch (error) {
      expect(error).toBeInstanceOf(TenderAuditEventDecodeError)
      return (error as TenderAuditEventDecodeError).kind
    }
    throw new Error('Expected participant aggregate validation to fail')
  }

  expect(failureKind(decodeTenderAuditEvent({
    kind: 'access_slots_resolved',
    payload: {
      data: {
        accessSlots: { outsider: 1 },
        budgetByPlayer: { outsider: 2 },
        sampleCompensationByPlayer: {},
      },
      formatVersion: 1,
    },
    sequence: 1,
  }))).toBe('current_corruption')
  expect(failureKind(decodeTenderAuditEvent({
    kind: 'access_slot_timeout_resolved',
    payload: {
      data: {
        accessSlots: { 'player-a': 1 },
        budgetByPlayer: { 'player-a': 2 },
        sampleCompensationByPlayer: {},
        timedOutPlayerIds: ['outsider'],
      },
      formatVersion: 1,
    },
    sequence: 1,
  }))).toBe('current_corruption')
  expect(failureKind(decodeTenderAuditEvent({
    kind: 'power_allocation_timeout_resolved',
    payload: {
      data: { timedOutPlayerIds: ['outsider'] },
      formatVersion: 1,
    },
    sequence: 1,
  }))).toBe('current_corruption')
  expect(failureKind(decodeTenderAuditEvent({
    kind: 'access_slots_resolved',
    payload: { accessSlots: { outsider: 1 } },
    sequence: 1,
  }))).toBe('historical_incompatible')
})

test('keeps a failed v1 Contract bid with its conditions and submitted evidence', () => {
  const evidenceTest = {
    playerId: 'player-a',
    protocol: 'impulse' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'round-1-failed-bid-evidence',
  }
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicScientificJournal: [evidenceTest],
    publicTheses: [],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const event = decodeTenderAuditEvent({
    actorId: 'player-a',
    commandId: 'failed-bid-command',
    kind: 'contract_bid_assessed',
    payload: {
      data: {
        awarded: false,
        contractId: 'round-1-contract-2',
        corporateTrustByPlayer: { 'player-a': 0 },
        evidenceTestIds: [evidenceTest.testId],
        playerId: 'player-a',
        ratingAward: 0,
        ratingByPlayer: { 'player-a': 0 },
      },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(createParticipantAuditRounds(tender, [event])).toMatchObject([{
    contracts: [{
      conditions: {
        kind: 'complex',
        ratingReward: 4,
        requiredPublicResult: 'attenuation',
        requiredSecondaryPublicResult: 'transmission_gain',
        targetRole: 'receiver',
        targetSignal: 'boreal',
      },
      contractId: 'round-1-contract-2',
      evidenceTestIds: [evidenceTest.testId],
      evidenceTests: [evidenceTest],
      outcome: 'failed',
      playerId: 'player-a',
      ratingAward: 0,
    }],
    ratingChanges: [],
  }])
})

test('rejects contradictory current Contract outcomes while retaining legacy awarded audit', () => {
  const contractProof = {
    playerId: 'player-a',
    protocol: 'continuous' as const,
    publicResult: 'attenuation' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'contract-proof',
  }
  const lightProof = {
    playerId: 'player-a',
    protocol: 'impulse' as const,
    publicResult: 'transmission_gain' as const,
    receiverSignal: 'aster' as const,
    sourceSignal: 'cinder' as const,
    testId: 'light-proof',
  }
  const finalContinuousProof = {
    playerId: 'player-a',
    protocol: 'continuous' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'final-continuous-proof',
  }
  const finalPrimaryImpulse = {
    playerId: 'player-a',
    protocol: 'impulse' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'final-primary-impulse',
  }
  const finalSecondaryImpulse = {
    playerId: 'player-a',
    protocol: 'impulse' as const,
    publicResult: 'attenuation' as const,
    receiverSignal: 'cinder' as const,
    sourceSignal: 'aster' as const,
    testId: 'final-secondary-impulse',
  }
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
    privateThesesByPlayer: {},
    publicFinalContract: {
      contractId: 'final-contract',
      kind: 'final',
      ratingReward: 8,
      requiredPublicResult: 'reflection',
      requiredSecondaryPublicResult: 'attenuation',
      targetRole: 'source',
      targetSignal: 'aster',
    },
    publicScientificJournal: [
      contractProof,
      lightProof,
      finalContinuousProof,
      finalPrimaryImpulse,
      finalSecondaryImpulse,
    ],
    publicTheses: [],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const currentEvent = (
    awarded: boolean,
    awardedToPlayerId: string | undefined,
    ratingAward: number,
    contractId = 'round-1-contract-2',
    evidenceTestIds = awarded ? [contractProof.testId] : [],
    researchCertificationSignal?: 'aster' | 'boreal',
  ) => decodeTenderAuditEvent({
    actorId: 'player-a',
    commandId: 'contract-bid-command',
    kind: 'contract_bid_assessed',
    payload: {
      data: {
        awarded,
        ...(awardedToPlayerId ? { awardedToPlayerId } : {}),
        contractId,
        corporateTrustByPlayer: { 'player-a': 0 },
        evidenceTestIds,
        playerId: 'player-a',
        ratingAward,
        ratingByPlayer: { 'player-a': ratingAward },
        ...(researchCertificationSignal ? { researchCertificationSignal } : {}),
      },
      formatVersion: 1,
    },
    sequence: 1,
  })

  expect(() => createParticipantAuditRounds(tender, [currentEvent(false, 'player-a', 4)]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(tender, [currentEvent(true, undefined, 4)]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(tender, [currentEvent(true, 'player-a', 2)]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(
    tender,
    [currentEvent(false, undefined, 0, 'round-1-contract-99', [])],
  )).toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(createParticipantAuditRounds(tender, [currentEvent(true, 'player-a', 4)])[0]?.contracts)
    .toMatchObject([{ outcome: 'awarded', playerId: 'player-a', ratingAward: 4 }])

  expect(() => createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 3, 'round-1-contract-1', [])],
  )).toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(() => createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 3, 'round-1-contract-1', [], 'boreal')],
  )).toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 3, 'round-1-contract-1', [], 'aster')],
  )[0]?.contracts).toMatchObject([{
    contractId: 'round-1-contract-1',
    researchCertificationSignal: 'aster',
  }])

  expect(() => createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 2, 'round-1-contract-3', [])],
  )).toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 2, 'round-1-contract-3', [lightProof.testId])],
  )[0]?.contracts).toMatchObject([{ contractId: 'round-1-contract-3', ratingAward: 2 }])

  expect(() => createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 8, 'final-contract', [finalPrimaryImpulse.testId])],
  )).toThrow(expect.objectContaining({ kind: 'current_corruption' }))
  expect(createParticipantAuditRounds(
    tender,
    [currentEvent(true, 'player-a', 8, 'final-contract', [finalContinuousProof.testId])],
  )[0]?.contracts).toMatchObject([{ contractId: 'final-contract', ratingAward: 8 }])
  expect(createParticipantAuditRounds(tender, [currentEvent(
    true,
    'player-a',
    8,
    'final-contract',
    [finalPrimaryImpulse.testId, finalSecondaryImpulse.testId],
  )])[0]?.contracts).toMatchObject([{ contractId: 'final-contract', ratingAward: 8 }])

  const v2Tender = { ...tender, ruleset: 'tender-v2' as const }
  expect(() => createParticipantAuditRounds(v2Tender, [currentEvent(false, undefined, 0)]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))

  const legacyAward = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'contract_bid_assessed',
    payload: {
      awarded: true,
      contractId: 'round-1-contract-2',
      evidenceTestIds: [contractProof.testId],
      playerId: 'player-a',
      ratingAward: 4,
    },
    sequence: 1,
  })
  expect(createParticipantAuditRounds(tender, [legacyAward])[0]?.contracts)
    .toMatchObject([{ outcome: 'awarded', playerId: 'player-a', ratingAward: 4 }])

  const legacyV2Failure = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'contract_bid_assessed',
    payload: {
      awarded: false,
      contractId: 'round-1-contract-99',
      evidenceTestIds: [],
      playerId: 'player-a',
      ratingAward: 0,
    },
    sequence: 1,
  })
  expect(() => createParticipantAuditRounds(v2Tender, [legacyV2Failure]))
    .toThrow(expect.objectContaining({ kind: 'historical_incompatible' }))
})

test('reconstructs a failed legacy-deck Contract with the persisted deck version', () => {
  const tender = {
    ...baseTender,
    anomalyConfiguration: {
      ...anomalyConfiguration,
      seed: 'ccb4c85e-e608-4a31-b150-89f095163959',
    },
    certifiedSignalsByPlayer: {},
    contractDeckVersion: 'legacy-v1',
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
    privateThesesByPlayer: {},
    publicTheses: [],
    round: 2,
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const events = [
    decodeTenderAuditEvent({
      kind: 'access_slots_resolved',
      payload: {
        data: {
          accessSlots: { 'player-a': 1, 'player-b': 2 },
          budgetByPlayer: { 'player-a': 2, 'player-b': 2 },
          sampleCompensationByPlayer: {},
        },
        formatVersion: 1,
      },
      sequence: 1,
    }),
    decodeTenderAuditEvent({
      actorId: 'player-a',
      kind: 'access_slot_requested',
      payload: {
        data: { playerId: 'player-a', slot: 1 },
        formatVersion: 1,
      },
      sequence: 2,
    }),
    decodeTenderAuditEvent({
      actorId: 'player-a',
      kind: 'contract_bid_assessed',
      payload: {
        data: {
          awarded: false,
          contractId: 'round-2-contract-2',
          corporateTrustByPlayer: { 'player-a': 0, 'player-b': 0 },
          evidenceTestIds: [],
          playerId: 'player-a',
          ratingAward: 0,
          ratingByPlayer: { 'player-a': 0, 'player-b': 0 },
        },
        formatVersion: 1,
      },
      sequence: 3,
    }),
  ]

  expect(createParticipantAuditRounds(tender, events)[1]?.contracts[0]?.conditions).toMatchObject({
    requiredPublicResult: 'attenuation',
    targetRole: 'receiver',
    targetSignal: 'boreal',
  })
})

test('classifies an unmatched v1 public Thesis as current corruption for format 1 history', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'positive',
      signalId: 'aster',
      verification: 'standard',
    }],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const event = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'access_slot_requested',
    payload: {
      data: { playerId: 'player-a', slot: 1 },
      formatVersion: 1,
    },
    sequence: 1,
  })
  let failure: unknown

  try {
    createParticipantAuditRounds(tender, [event])
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(TenderAuditEventDecodeError)
  expect(failure).toMatchObject({ kind: 'current_corruption' })
})

test('classifies the pre-private v2 public Thesis cohort as historical incompatibility', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'positive',
      signalId: 'aster',
      verification: 'standard',
    }],
    ruleset: 'tender-v2',
  } as unknown as StoredTender

  const legacyEvent = decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'thesis_checked',
    payload: { correct: true, playerId: 'player-a', signalId: 'aster' },
    sequence: 1,
  })

  expect(() => createParticipantAuditRounds(tender, [legacyEvent]))
    .toThrow(expect.objectContaining({ kind: 'historical_incompatible' }))

  const currentEvent = decodeTenderAuditEvent({
    actorId: 'player-a',
    commandId: 'current-public-v2-thesis',
    kind: 'thesis_checked',
    payload: {
      data: { correct: true, playerId: 'player-a', signalId: 'aster' },
      formatVersion: 1,
    },
    sequence: 1,
  })
  expect(() => createParticipantAuditRounds(tender, [currentEvent]))
    .toThrow(expect.objectContaining({ kind: 'current_corruption' }))
})

test('does not let unrelated legacy round history mask a missing current Thesis event', () => {
  const tender = {
    ...baseTender,
    certifiedSignalsByPlayer: {},
    privateThesesByPlayer: {},
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'positive',
      signalId: 'aster',
      verification: 'standard',
    }],
    ruleset: 'tender-v1',
  } as unknown as StoredTender
  const failureKind = (event: ReturnType<typeof decodeTenderAuditEvent>) => {
    try {
      createParticipantAuditRounds(tender, [event])
    } catch (error) {
      expect(error).toBeInstanceOf(TenderAuditEventDecodeError)
      return (error as TenderAuditEventDecodeError).kind
    }
    throw new Error('Expected participant audit reconstruction to fail')
  }

  expect(failureKind(decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'access_slot_requested',
    payload: { playerId: 'player-a', slot: 1 },
    sequence: 1,
  }))).toBe('current_corruption')
  expect(failureKind(decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'working_model_updated',
    payload: { playerId: 'player-a' },
    sequence: 1,
  }))).toBe('current_corruption')
  expect(failureKind(decodeTenderAuditEvent({
    actorId: 'player-a',
    kind: 'thesis_checked',
    payload: { correct: false, playerId: 'player-a', signalId: 'boreal' },
    sequence: 1,
  }))).toBe('historical_incompatible')
})
