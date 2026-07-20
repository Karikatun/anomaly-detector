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
        publicContracts: [
          { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
          {
            awardedToPlayerId: 'player-a',
            bidOutcome: 'awarded',
            contractId: 'round-1-contract-2',
            requiredPublicResult: 'attenuation',
            reservedByPlayerId: 'player-a',
          },
          { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
        ],
        publicLaboratoryResults: [],
        round: 1,
        tenderId: 'tender-1',
        version: 1,
        phase: 'access-slot-selection',
        players: [
          { budget: 2, contractPowerRestriction: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
          { budget: 2, contractPowerRestriction: 0, playerId: 'player-b', rating: 0 },
        ],
        privateAnalyticalReports: 1,
        privateRawTelemetrySignals: ['aster'],
        privateMeasurements: [],
        privateSamples: ['aster'],
        privateWorkingModel: { signals: {} },
        publicTheses: [],
      }),
    ).toEqual({
      knownSignals: ['aster', 'boreal'],
      publicContracts: [
        { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
        {
          awardedToPlayerId: 'player-a',
          bidOutcome: 'awarded',
          contractId: 'round-1-contract-2',
          requiredPublicResult: 'attenuation',
          reservedByPlayerId: 'player-a',
        },
        { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
      ],
      publicLaboratoryResults: [],
      round: 1,
      tenderId: 'tender-1',
      version: 1,
      phase: 'access-slot-selection',
      players: [
        { budget: 2, contractPowerRestriction: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
        { budget: 2, contractPowerRestriction: 0, playerId: 'player-b', rating: 0 },
      ],
      privateAnalyticalReports: 1,
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
      privateWorkingModel: { signals: {} },
      publicTheses: [],
    })
  })

  test('validates a Working Model update command', () => {
    expect(
      tenderCommandSchema.parse({
        actorId: 'player-a',
        commandId: 'command-a-working-model-1',
        tenderId: 'tender-1',
        type: 'update-working-model',
        workingModel: {
          signals: {
            aster: {
              excludedFieldTypes: ['phase'],
              hypothesis: { fieldType: 'inertial', polarity: 'positive' },
              note: 'Candidate source for reflection.',
              possiblePolarities: ['positive'],
            },
          },
        },
      }),
    ).toMatchObject({ type: 'update-working-model' })
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

  test('validates a Contract reservation command', () => {
    expect(
      tenderCommandSchema.parse({
        actorId: 'player-a',
        commandId: 'command-a-5',
        contractId: 'round-1-contract-1',
        tenderId: 'tender-1',
        type: 'reserve-contract',
      }),
    ).toMatchObject({ type: 'reserve-contract' })
  })

  test('validates a Contract bid command', () => {
    expect(
      tenderCommandSchema.parse({
        actorId: 'player-a',
        claimedPublicResult: 'reflection',
        commandId: 'command-a-6',
        contractId: 'round-1-contract-1',
        requestedFunding: 2,
        tenderId: 'tender-1',
        type: 'submit-contract-bid',
      }),
    ).toMatchObject({ type: 'submit-contract-bid' })
  })
})
