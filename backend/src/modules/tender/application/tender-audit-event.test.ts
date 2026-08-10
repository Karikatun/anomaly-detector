import { expect, test } from 'bun:test'

import {
  decodeTenderAuditEvent,
  encodeTenderAuditEventPayload,
  TenderAuditEventDecodeError,
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

test('decodes known legacy events without treating unknown kinds as valid', () => {
  expect(decodeTenderAuditEvent({
    kind: 'access_slots_resolved',
    payload: { accessSlots: { 'player-a': 2 } },
    sequence: 1,
  })).toEqual({
    formatVersion: 0,
    kind: 'access_slots_resolved',
    payload: { accessSlots: { 'player-a': 2 } },
    sequence: 1,
  })
  expect(() => decodeTenderAuditEvent({
    kind: 'unknown_legacy_event',
    payload: {},
    sequence: 2,
  })).toThrow(TenderAuditEventDecodeError)
})

test('rejects an unsupported persisted Tender audit format version', () => {
  expect(() => decodeTenderAuditEvent({
    kind: requestedSlotEvent.kind,
    payload: { data: requestedSlotEvent.payload, formatVersion: 2 },
    sequence: 1,
  })).toThrow('Unsupported Tender audit event format version 2')
})
