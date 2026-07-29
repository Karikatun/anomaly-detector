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
          { budget: 2, contractPowerRestriction: 0, corporateTrust: 1, finalScientificModelSubmitted: true, playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
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
        { budget: 2, contractPowerRestriction: 0, corporateTrust: 1, finalScientificModelSubmitted: true, playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
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

    expect(powerAllocationSchema.parse({
      contracts: 1,
      laboratory: 0,
      modelAnalysis: 2,
      reconnaissance: 1,
    })).toEqual({
      contracts: 1,
      laboratory: 0,
      modelAnalysis: 2,
      reconnaissance: 1,
    })
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

  test('validates strict Laboratory modes and rejects duplicate broad pairs', () => {
    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-deep',
      laboratory: {
        mode: 'deep',
        pair: { receiverSignal: 'boreal', sourceSignal: 'aster' },
      },
      tenderId: 'tender-1',
      type: 'run-laboratory-test',
    })).toMatchObject({ laboratory: { mode: 'deep' } })

    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-broad',
      laboratory: {
        mode: 'broad',
        pairs: [
          { receiverSignal: 'boreal', sourceSignal: 'aster' },
          { receiverSignal: 'delta', sourceSignal: 'cinder' },
        ],
      },
      tenderId: 'tender-1',
      type: 'run-laboratory-test',
    })).toMatchObject({ laboratory: { mode: 'broad' } })

    expect(() => tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-duplicate-broad',
      laboratory: {
        mode: 'broad',
        pairs: [
          { receiverSignal: 'boreal', sourceSignal: 'aster' },
          { receiverSignal: 'boreal', sourceSignal: 'aster' },
        ],
      },
      tenderId: 'tender-1',
      type: 'run-laboratory-test',
    })).toThrow()
  })

  test('validates private Thesis results and voluntary Model Analysis completion', () => {
    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-finish-analysis',
      tenderId: 'tender-1',
      type: 'finish-model-analysis',
    })).toMatchObject({ type: 'finish-model-analysis' })

    expect(tenderViewSchema.parse({
      knownSignals: ['aster'],
      modelAnalysisProgress: { completed: 1, total: 2 },
      phase: 'model-analysis',
      players: [{ budget: 1, contractPowerRestriction: 0, playerId: 'player-a', rating: 1 }],
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateSamples: ['aster'],
      privateTheses: [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: false,
        id: 'r1-player-a-thesis-1',
        polarity: 'negative',
        polarityCorrect: false,
        round: 1,
        signalId: 'aster',
      }],
      privateWorkingModel: { signals: {} },
      publicContracts: [],
      publicLaboratoryResults: [],
      publicTheses: [],
      round: 1,
      ruleset: 'tender-v2',
      serverTime: '2026-07-26T12:00:00.000Z',
      tenderId: 'tender-1',
      version: 4,
    })).toMatchObject({
      modelAnalysisProgress: { completed: 1, total: 2 },
      privateTheses: [{ fieldTypeCorrect: true, polarityCorrect: false }],
    })
  })

  test('validates a private Final Scientific Model draft and aggregate progress', () => {
    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-final-draft',
      scientificModelDraft: { signals: {} },
      tenderId: 'tender-1',
      type: 'update-scientific-model-draft',
    })).toMatchObject({ scientificModelDraft: { signals: {} } })

    expect(tenderViewSchema.parse({
      finalScientificModelProgress: { completed: 1, total: 2 },
      knownSignals: ['aster'],
      phase: 'final-scientific-model',
      players: [
        { budget: 1, contractPowerRestriction: 0, playerId: 'player-a', rating: 1 },
        { budget: 2, contractPowerRestriction: 0, playerId: 'player-b', rating: 0 },
      ],
      privateFinalScientificModelDraft: {
        signals: { aster: { fieldType: 'inertial' } },
      },
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateSamples: ['aster'],
      privateWorkingModel: { signals: {} },
      publicContracts: [],
      publicFinalContract: {
        contractId: 'final-contract',
        kind: 'final',
        ratingReward: 8,
        requiredPublicResult: 'reflection',
        requiredSecondaryPublicResult: 'attenuation',
        targetRole: 'source',
        targetSignal: 'ferro',
      },
      publicLaboratoryResults: [],
      publicTheses: [],
      round: 5,
      ruleset: 'tender-v2',
      serverTime: '2026-07-29T12:00:00.000Z',
      tenderId: 'tender-1',
      version: 20,
    })).toMatchObject({
      finalScientificModelProgress: { completed: 1, total: 2 },
      privateFinalScientificModelDraft: {
        signals: { aster: { fieldType: 'inertial' } },
      },
    })
  })

  test('validates permanent Tender forfeit state and early completion reason', () => {
    expect(tenderCommandSchema.parse({
      actorId: 'player-a',
      commandId: 'command-a-forfeit',
      tenderId: 'tender-1',
      type: 'forfeit-tender',
    })).toMatchObject({ type: 'forfeit-tender' })
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
      ratingBreakdownByPlayer: {
        'player-a': {
          completeModelBonus: 3,
          contractPoints: 4,
          correctPropertyPoints: 8,
          correctSignalPoints: 4,
          otherPoints: 0,
          thesisPoints: 2,
          total: 21,
        },
      },
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
      ratingBreakdownByPlayer: {
        'player-a': { contractPoints: 4, thesisPoints: 2, total: 21 },
      },
    })
  })
})
