import { expect, test } from 'bun:test'

import { hasParticipantAuditSemantics } from './audit-view'
import {
  decodeTenderAuditEvent,
  encodeTenderAuditEventPayload,
  TenderAuditEventDecodeError,
  tenderAuditEventKinds,
} from './tender-audit-event'

const requestedSlotEvent = {
  actorId: 'player-a',
  commandId: 'command-1',
  kind: 'access_slot_requested',
  payload: { playerId: 'player-a', slot: 2 },
} as const

test('round-trips a versioned Tender audit event through its persistence envelope', () => {
  const payload = encodeTenderAuditEventPayload(requestedSlotEvent)

  expect(payload).toEqual({
    data: { playerId: 'player-a', slot: 2 },
    formatVersion: 1,
  })
  expect(decodeTenderAuditEvent({
    ...requestedSlotEvent,
    payload,
    sequence: 4,
  })).toEqual({
    ...requestedSlotEvent,
    formatVersion: 1,
    sequence: 4,
  })
})

test('rejects unknown producers and malformed payloads before persistence', () => {
  expect(() => encodeTenderAuditEventPayload({
    kind: 'access_slot_typo',
    payload: { playerId: 'player-a', slot: 2 },
  } as never)).toThrow(TenderAuditEventDecodeError)
  expect(() => encodeTenderAuditEventPayload({
    kind: 'access_slot_requested',
    payload: { playerId: 'player-a', slot: 'second' },
  } as never)).toThrow(TenderAuditEventDecodeError)
})

test('decodes known legacy events for consumer-specific semantic validation', () => {
  const event = decodeTenderAuditEvent({
    kind: 'access_slots_resolved',
    payload: { accessSlots: { 'player-a': 2 } },
    sequence: 1,
  })
  expect(event).toEqual({
    formatVersion: 0,
    kind: 'access_slots_resolved',
    payload: { accessSlots: { 'player-a': 2 } },
    sequence: 1,
  })
  expect(hasParticipantAuditSemantics(event)).toBe(true)
  expect(() => decodeTenderAuditEvent({
    kind: 'unknown_legacy_event',
    payload: {},
    sequence: 2,
  })).toThrow(TenderAuditEventDecodeError)
})

test('rejects every known version 0 kind from the participant audit when required semantics are missing', () => {
  for (const kind of tenderAuditEventKinds) {
    const event = decodeTenderAuditEvent({ kind, payload: {}, sequence: 1 })
    expect(hasParticipantAuditSemantics(event)).toBe(false)
  }
})

test.each([
  {
    kind: 'power_allocated',
    payload: {
      allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 },
      playerId: 'player-a',
    },
  },
  {
    kind: 'access_slot_timeout_resolved',
    payload: { accessSlots: { 'player-a': 2 }, timedOutPlayerIds: ['player-a'] },
  },
  {
    kind: 'laboratory_test_completed',
    payload: {
      mode: 'deep',
      playerId: 'player-a',
      results: [{
        protocol: 'continuous',
        publicResult: 'attenuation',
        receiverSignal: 'boreal',
        sourceSignal: 'aster',
      }],
    },
  },
  {
    kind: 'contract_bid_assessed',
    payload: {
      awarded: true,
      contractId: 'round-1-contract-2',
      evidenceTestIds: ['r1-t1'],
      playerId: 'player-a',
      ratingAward: 4,
    },
  },
  {
    kind: 'private_thesis_checked',
    payload: {
      fieldTypeCorrect: true,
      fullyCorrect: true,
      playerId: 'player-a',
      polarityCorrect: true,
      signalId: 'aster',
      thesisId: 'legacy-thesis-a',
    },
  },
] as const)('accepts the supported $kind version 0 history shape', ({ kind, payload }) => {
  const event = decodeTenderAuditEvent({ kind, payload, sequence: 1 })
  expect(event).toMatchObject({
    formatVersion: 0,
    kind,
    payload,
    sequence: 1,
  })
  expect(hasParticipantAuditSemantics(event)).toBe(true)
})

test.each([
  ['scientific_model_scored', { correctProperties: 9, playerId: 'player-a' }],
  ['contract_bid_assessed', { awarded: true, playerId: 'player-a' }],
] as const)('keeps sparse %s history usable by non-participant read models', (kind, payload) => {
  const event = decodeTenderAuditEvent({ kind, payload, sequence: 1 })

  expect(event).toMatchObject({ formatVersion: 0, kind, payload })
  expect(hasParticipantAuditSemantics(event)).toBe(false)
})

test('classifies malformed version 1 data as current corruption', () => {
  let failure: unknown
  try {
    decodeTenderAuditEvent({
      kind: 'power_allocated',
      payload: { data: {}, formatVersion: 1 },
      sequence: 1,
    })
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(TenderAuditEventDecodeError)
  expect(failure).toMatchObject({ kind: 'current_corruption' })
})

test('rejects an unsupported persisted Tender audit format version', () => {
  expect(() => decodeTenderAuditEvent({
    kind: requestedSlotEvent.kind,
    payload: { data: requestedSlotEvent.payload, formatVersion: 2 },
    sequence: 1,
  })).toThrow('Unsupported Tender audit event format version 2')
})
