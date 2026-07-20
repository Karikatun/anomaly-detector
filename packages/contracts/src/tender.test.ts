import { describe, expect, test } from 'bun:test'

import {
  commandReceiptSchema,
  powerAllocationSchema,
  signalIdSchema,
  tenderCommandSchema,
  tenderViewSchema,
} from './index'

describe('Tender contracts', () => {
  test('validates the Access Slot command, receipt, and player-scoped view', () => {
    expect(
      tenderCommandSchema.parse({
        commandId: 'command-a-1',
        tenderId: 'tender-1',
        actorId: 'player-a',
        type: 'request-access-slot',
        slot: 1,
      }),
    ).toEqual({
      commandId: 'command-a-1',
      tenderId: 'tender-1',
      actorId: 'player-a',
      type: 'request-access-slot',
      slot: 1,
    })

    expect(commandReceiptSchema.parse({ tenderId: 'tender-1', version: 1 })).toEqual({
      tenderId: 'tender-1',
      version: 1,
    })

    expect(
      tenderViewSchema.parse({
        knownSignals: ['aster', 'boreal'],
        tenderId: 'tender-1',
        version: 1,
        phase: 'access-slot-selection',
        players: [
          { playerId: 'player-a', requestedAccessSlot: 1 },
          { playerId: 'player-b' },
        ],
        privateRawTelemetrySignals: ['aster'],
        privateMeasurements: [],
        privateSamples: ['aster'],
        publicTheses: [],
      }),
    ).toEqual({
      knownSignals: ['aster', 'boreal'],
      tenderId: 'tender-1',
      version: 1,
      phase: 'access-slot-selection',
      players: [
        { playerId: 'player-a', requestedAccessSlot: 1 },
        { playerId: 'player-b' },
      ],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
      publicTheses: [],
    })
  })

  test('validates an open Power allocation', () => {
    expect(
      powerAllocationSchema.parse({
        contracts: 1,
        laboratory: 1,
        modelAnalysis: 0,
        reconnaissance: 2,
      }),
    ).toEqual({
      contracts: 1,
      laboratory: 1,
      modelAnalysis: 0,
      reconnaissance: 2,
    })

    expect(
      tenderCommandSchema.parse({
        allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
        actorId: 'player-b',
        commandId: 'command-b-2',
        tenderId: 'tender-1',
        type: 'allocate-power',
      }),
    ).toMatchObject({ type: 'allocate-power' })

    expect(() => powerAllocationSchema.parse({
      contracts: 2,
      laboratory: 2,
      modelAnalysis: 1,
      reconnaissance: 0,
    })).toThrow()
  })

  test('validates a Reconnaissance command with one or two distinct Signals', () => {
    expect(signalIdSchema.parse('aster')).toBe('aster')
    expect(
      tenderCommandSchema.parse({
        actorId: 'player-a',
        commandId: 'command-a-3',
        signals: ['cinder', 'delta'],
        tenderId: 'tender-1',
        type: 'conduct-reconnaissance',
      }),
    ).toMatchObject({ type: 'conduct-reconnaissance' })
  })
})
