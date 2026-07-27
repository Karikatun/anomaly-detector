import { describe, expect, test } from 'bun:test'

import {
  commandReceiptSchema,
  powerAllocationSchema,
  signalIdSchema,
  tenderAuditViewSchema,
  tenderCommandSchema,
  tenderViewSchema,
} from './index'

describe('Tender contracts', () => {
  test('allows an Access Slot cost to put a player into a budget deficit', () => {
    const view = tenderViewSchema.parse({
      knownSignals: ['aster', 'boreal'],
      publicContracts: [],
      publicLaboratoryResults: [],
      privateUsedContractEvidenceTestIds: ['round-1-test-1'],
      round: 2,
      serverTime: '2026-07-26T12:00:00.000Z',
      tenderId: 'tender-1',
      version: 14,
      phase: 'power-allocation',
      players: [{ budget: -1, contractPowerRestriction: 0, playerId: 'player-a', rating: 0 }],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
      privateWorkingModel: { signals: {} },
      publicTheses: [],
    })

    expect(view.players[0]?.budget).toBe(-1)
    expect(view.privateUsedContractEvidenceTestIds).toEqual(['round-1-test-1'])
  })

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
        activePlayerId: 'player-a',
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
        serverTime: '2026-07-26T12:00:00.000Z',
        tenderId: 'tender-1',
        version: 1,
        phase: 'access-slot-selection',
        players: [
          { budget: 2, contractPowerRestriction: 0, corporateTrust: 1, playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
          { budget: 2, contractPowerRestriction: 0, playerId: 'player-b', rating: 0, tiePriority: 2 },
        ],
        privateRawTelemetrySignals: ['aster'],
        privateMeasurements: [],
        privateSamples: ['aster'],
        privateWorkingModel: { signals: {} },
        publicTheses: [{
          correct: true,
          fieldType: 'inertial',
          playerId: 'player-a',
          polarity: 'positive',
          signalId: 'aster',
          verification: 'extended',
        }],
      }),
    ).toEqual({
      activePlayerId: 'player-a',
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
      serverTime: '2026-07-26T12:00:00.000Z',
      tenderId: 'tender-1',
      version: 1,
      phase: 'access-slot-selection',
      players: [
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 1, playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
        { budget: 2, contractPowerRestriction: 0, playerId: 'player-b', rating: 0, tiePriority: 2 },
      ],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
      privateWorkingModel: { signals: {} },
      publicTheses: [{
        correct: true,
        fieldType: 'inertial',
        playerId: 'player-a',
        polarity: 'positive',
        signalId: 'aster',
        verification: 'extended',
      }],
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

  test('validates an explicit Contract skip command', () => {
    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-skip-contract',
      tenderId: 'tender-1',
      type: 'skip-contract',
    })).toMatchObject({ type: 'skip-contract' })
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
      modelAnalysis: 0,
      reconnaissance: 0,
    })).toThrow()

    expect(() => powerAllocationSchema.parse({
      contracts: 1,
      laboratory: 0,
      modelAnalysis: 2,
      reconnaissance: 1,
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
        commandId: 'command-a-6',
        contractId: 'round-1-contract-1',
        evidenceTestIds: ['r1-t1'],
        tenderId: 'tender-1',
        type: 'submit-contract-bid',
      }),
    ).toMatchObject({ type: 'submit-contract-bid' })
  })

  test('validates a participant audit replay with private measurements and public laboratory results', () => {
    expect(tenderAuditViewSchema.parse({
      anomalyConfiguration: {
        seed: 'seed-1',
        signals: {
          aster: { fieldType: 'inertial', polarity: 'positive' },
          boreal: { fieldType: 'inertial', polarity: 'negative' },
          cinder: { fieldType: 'electromagnetic', polarity: 'positive' },
          delta: { fieldType: 'electromagnetic', polarity: 'negative' },
          eclipse: { fieldType: 'phase', polarity: 'positive' },
          ferro: { fieldType: 'phase', polarity: 'negative' },
        },
      },
      events: [{
        actorId: 'player-a',
        commandId: 'command-a-4',
        kind: 'laboratory_test_completed',
        payload: { playerId: 'player-a', protocol: 'continuous' },
        sequence: 1,
      }],
      privateMeasurementsByPlayer: {
        'player-a': [{ polarityRelation: 'same', receiverSignal: 'cinder', sourceSignal: 'aster' }],
      },
      publicLaboratoryResults: [{
        playerId: 'player-a',
        protocol: 'continuous',
        publicResult: 'transmission_gain',
        receiverSignal: 'cinder',
        sourceSignal: 'aster',
      }],
    })).toMatchObject({
      events: [{ kind: 'laboratory_test_completed', sequence: 1 }],
    })
  })
})
