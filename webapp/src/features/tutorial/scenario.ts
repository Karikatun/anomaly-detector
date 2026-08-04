import type {
  FieldType,
  PrivateThesis,
  Polarity,
  SignalId,
  TenderPhase,
  TenderView,
  WorkingModel,
} from '@anomaly-detector/contracts'

import type { TenderCommandInput } from '@/features/tender/public/tutorial-board'
import { translate } from '@/platform/i18n'

export const tutorialContractId = 'tutorial-light-contract'

export type TutorialStep =
  | 'round-1-access'
  | 'round-1-power'
  | 'round-1-recon'
  | 'round-1-lab'
  | 'help-menu'
  | 'interpretation'
  | 'interpretation-open'
  | 'round-1-working-model'
  | 'round-1-thesis'
  | 'round-2-access'
  | 'round-2-power'
  | 'round-2-recon'
  | 'round-2-lab'
  | 'round-2-working-model'
  | 'round-2-thesis'
  | 'round-2-contract-reserve'
  | 'round-2-contract-bid'
  | 'final-model'
  | 'complete'

export type TutorialState = {
  budget: number
  corporateTrust: number
  hintLevel: number
  playerId: string
  privateTheses: PrivateThesis[]
  rating: number
  round: 1 | 2
  step: TutorialStep
  thesisAttempts: number
  workingModel: WorkingModel
}

export type TutorialUiAction =
  | { type: 'open-help-menu' }
  | { type: 'open-interpretation' }
  | { type: 'open-interpretation-direct' }
  | { type: 'close-interpretation' }

export type TutorialAction = TenderCommandInput | TutorialUiAction

export type TutorialAdvanceResult = {
  progressed: boolean
  state: TutorialState
  thesisFeedback?: {
    fieldTypeCorrect: boolean
    polarityCorrect: boolean
  }
}

const signalProperties: Record<SignalId, { fieldType: FieldType; polarity: Polarity }> = {
  aster: { fieldType: 'inertial', polarity: 'positive' },
  boreal: { fieldType: 'electromagnetic', polarity: 'positive' },
  cinder: { fieldType: 'phase', polarity: 'negative' },
  delta: { fieldType: 'inertial', polarity: 'negative' },
  eclipse: { fieldType: 'electromagnetic', polarity: 'negative' },
  ferro: { fieldType: 'phase', polarity: 'positive' },
}

export function createTutorialState(playerId: string): TutorialState {
  return {
    budget: 2,
    corporateTrust: 0,
    hintLevel: 0,
    playerId,
    privateTheses: [],
    rating: 0,
    round: 1,
    step: 'round-1-access',
    thesisAttempts: 0,
    workingModel: { signals: {} },
  }
}

export function advanceTutorial(
  state: TutorialState,
  action: TutorialAction,
): TutorialAdvanceResult {
  switch (state.step) {
    case 'round-1-access':
      return action.type === 'request-access-slot' && action.slot === 5
        ? progressed(state, { step: 'round-1-power' })
        : unchanged(state)
    case 'round-1-power':
      return action.type === 'allocate-power' && allocationMatches(action.allocation, [1, 2, 1, 0])
        ? progressed(state, { step: 'round-1-recon' })
        : unchanged(state)
    case 'round-1-recon':
      return isUnknownRecon(action)
        ? progressed(state, { step: 'round-1-lab' })
        : unchanged(state)
    case 'round-1-lab':
      return action.type === 'run-laboratory-test'
        && 'laboratory' in action
        && action.laboratory.mode === 'deep'
        && pairMatches(action.laboratory.pair, 'aster', 'boreal')
        ? progressed(state, { step: 'help-menu' })
        : unchanged(state)
    case 'help-menu':
      return action.type === 'open-help-menu'
        ? progressed(state, { step: 'interpretation' })
        : action.type === 'open-interpretation-direct'
          ? progressed(state, { step: 'interpretation-open' })
          : unchanged(state)
    case 'interpretation':
      return action.type === 'open-interpretation'
        ? progressed(state, { step: 'interpretation-open' })
        : unchanged(state)
    case 'interpretation-open':
      return action.type === 'close-interpretation'
        ? progressed(state, { step: 'round-1-working-model' })
        : unchanged(state)
    case 'round-1-working-model':
      return action.type === 'update-working-model'
        && hypothesisMatches(action.workingModel, 'aster')
        ? progressed(state, { step: 'round-1-thesis', workingModel: action.workingModel })
        : unchanged(state)
    case 'round-1-thesis':
      return resolveThesis(state, action, 'aster', 'round-2-access')
    case 'round-2-access':
      return action.type === 'request-access-slot' && action.slot === 4
        ? progressed(state, { budget: state.budget + 1, step: 'round-2-power' })
        : unchanged(state)
    case 'round-2-power':
      return action.type === 'allocate-power' && allocationMatches(action.allocation, [1, 1, 1, 1])
        ? progressed(state, { step: 'round-2-recon' })
        : unchanged(state)
    case 'round-2-recon':
      return isUnknownRecon(action)
        ? progressed(state, { step: 'round-2-lab' })
        : unchanged(state)
    case 'round-2-lab':
      return action.type === 'run-laboratory-test'
        && 'laboratory' in action
        && action.laboratory.mode === 'impulse'
        && pairMatches(action.laboratory.pair, 'boreal', 'cinder')
        ? progressed(state, { step: 'round-2-working-model' })
        : unchanged(state)
    case 'round-2-working-model':
      return action.type === 'update-working-model'
        && hypothesisMatches(action.workingModel, 'boreal')
        ? progressed(state, { step: 'round-2-thesis', workingModel: action.workingModel })
        : unchanged(state)
    case 'round-2-thesis':
      return resolveThesis(state, action, 'boreal', 'round-2-contract-reserve')
    case 'round-2-contract-reserve':
      return action.type === 'reserve-contract' && action.contractId === tutorialContractId
        ? progressed(state, { step: 'round-2-contract-bid' })
        : unchanged(state)
    case 'round-2-contract-bid':
      return action.type === 'submit-contract-bid'
        && action.contractId === tutorialContractId
        && action.evidenceTestIds?.length === 1
        && action.evidenceTestIds[0] === 'tutorial-test-2'
        ? progressed(state, {
          corporateTrust: state.corporateTrust + 1,
          rating: state.rating + 2,
          step: 'final-model',
        })
        : unchanged(state)
    case 'final-model':
      return action.type === 'update-scientific-model-draft'
        ? unchanged(state)
        : action.type === 'submit-scientific-model'
          && finalModelMatches(action.scientificModel.signals)
          ? progressed(state, { step: 'complete' })
          : unchanged(state)
    case 'complete':
      return unchanged(state)
  }
}

function resolveThesis(
  state: TutorialState,
  action: TutorialAction,
  signalId: 'aster' | 'boreal',
  nextStep: TutorialStep,
): TutorialAdvanceResult {
  if (action.type !== 'submit-thesis' || action.signalId !== signalId) return unchanged(state)
  const expected = signalProperties[signalId]
  const thesisFeedback = {
    fieldTypeCorrect: action.fieldType === expected.fieldType,
    polarityCorrect: action.polarity === expected.polarity,
  }
  const thesis: PrivateThesis = {
    fieldType: action.fieldType,
    fieldTypeCorrect: thesisFeedback.fieldTypeCorrect,
    fullyCorrect: thesisFeedback.fieldTypeCorrect && thesisFeedback.polarityCorrect,
    id: `tutorial-thesis-${state.privateTheses.length + 1}`,
    polarity: action.polarity,
    polarityCorrect: thesisFeedback.polarityCorrect,
    round: state.round,
    signalId,
  }
  if (thesisFeedback.fieldTypeCorrect && thesisFeedback.polarityCorrect) {
    return {
      ...progressed(state, {
        hintLevel: 0,
        privateTheses: [...state.privateTheses, thesis],
        rating: state.rating + 1,
        round: signalId === 'aster' ? 2 : state.round,
        step: nextStep,
        thesisAttempts: 0,
      }),
      thesisFeedback,
    }
  }
  const thesisAttempts = state.thesisAttempts + 1
  return {
    progressed: false,
    state: {
      ...state,
      hintLevel: thesisAttempts >= 2 ? 1 : state.hintLevel,
      privateTheses: [...state.privateTheses, thesis],
      thesisAttempts,
    },
    thesisFeedback,
  }
}

function allocationMatches(
  allocation: Extract<TenderCommandInput, { type: 'allocate-power' }>['allocation'],
  expected: [number, number, number, number],
) {
  return allocation.reconnaissance === expected[0]
    && allocation.laboratory === expected[1]
    && allocation.modelAnalysis === expected[2]
    && allocation.contracts === expected[3]
    && (allocation.reserve ?? 0) === 0
}

function isUnknownRecon(action: TutorialAction) {
  return action.type === 'conduct-reconnaissance'
    && action.targets?.length === 1
    && action.targets[0] === 'unknown-sector'
}

function pairMatches(
  pair: { receiverSignal: SignalId; sourceSignal: SignalId },
  sourceSignal: SignalId,
  receiverSignal: SignalId,
) {
  return pair.sourceSignal === sourceSignal && pair.receiverSignal === receiverSignal
}

function hypothesisMatches(model: WorkingModel, signalId: SignalId) {
  const expected = signalProperties[signalId]
  const hypothesis = model.signals[signalId]?.hypothesis
  return hypothesis?.fieldType === expected.fieldType && hypothesis.polarity === expected.polarity
}

function finalModelMatches(signals: Record<string, { fieldType?: FieldType; polarity?: Polarity } | undefined>) {
  return Object.keys(signals).length === 2
    && signals.aster?.fieldType === signalProperties.aster.fieldType
    && signals.aster?.polarity === signalProperties.aster.polarity
    && signals.boreal?.fieldType === signalProperties.boreal.fieldType
    && signals.boreal?.polarity === signalProperties.boreal.polarity
}

function progressed(state: TutorialState, changes: Partial<TutorialState>): TutorialAdvanceResult {
  return { progressed: true, state: { ...state, ...changes } }
}

function unchanged(state: TutorialState): TutorialAdvanceResult {
  return { progressed: false, state }
}

const orderedSteps: TutorialStep[] = [
  'round-1-access',
  'round-1-power',
  'round-1-recon',
  'round-1-lab',
  'help-menu',
  'interpretation',
  'interpretation-open',
  'round-1-working-model',
  'round-1-thesis',
  'round-2-access',
  'round-2-power',
  'round-2-recon',
  'round-2-lab',
  'round-2-working-model',
  'round-2-thesis',
  'round-2-contract-reserve',
  'round-2-contract-bid',
  'final-model',
  'complete',
]

export function tutorialView(state: TutorialState): TenderView {
  const phase = phaseForStep(state.step)
  const stepIndex = orderedSteps.indexOf(state.step)
  const hasRoundOneSample = stepIndex >= orderedSteps.indexOf('round-1-power')
  const hasBoreal = stepIndex >= orderedSteps.indexOf('round-1-lab')
  const hasRoundOneTest = stepIndex >= orderedSteps.indexOf('help-menu')
  const hasAsterThesis = stepIndex >= orderedSteps.indexOf('round-2-access')
  const hasCinder = stepIndex >= orderedSteps.indexOf('round-2-lab')
  const hasRoundTwoTest = stepIndex >= orderedSteps.indexOf('round-2-working-model')
  const hasBorealThesis = stepIndex >= orderedSteps.indexOf('round-2-contract-reserve')
  const roundOnePower = {
    contracts: 0,
    laboratory: 2,
    modelAnalysis: 1,
    reconnaissance: 1,
  } as const
  const roundTwoPower = {
    contracts: 1,
    laboratory: 1,
    modelAnalysis: 1,
    reconnaissance: 1,
  } as const
  const hasConfirmedPower = state.step !== 'round-1-access'
    && state.step !== 'round-1-power'
    && state.step !== 'round-2-access'
    && state.step !== 'round-2-power'
  const currentPower = state.round === 1 ? roundOnePower : roundTwoPower
  const samples: SignalId[] = [
    ...(hasRoundOneSample ? ['aster' as const] : []),
    ...(hasBoreal ? ['boreal' as const] : []),
    ...(hasCinder ? ['cinder' as const] : []),
  ]
  const journal = [
    ...(hasRoundOneTest ? [{
      playerId: state.playerId,
      protocol: 'continuous' as const,
      publicResult: 'reflection' as const,
      receiverSignal: 'boreal' as const,
      sourceSignal: 'aster' as const,
      testId: 'tutorial-test-1',
    }] : []),
    ...(hasRoundTwoTest ? [{
      playerId: state.playerId,
      protocol: 'impulse' as const,
      publicResult: 'unstable_collapse' as const,
      receiverSignal: 'cinder' as const,
      sourceSignal: 'boreal' as const,
      testId: 'tutorial-test-2',
    }] : []),
  ]
  const contractVisible = state.round === 2
    && stepIndex >= orderedSteps.indexOf('round-2-power')
  const contractReserved = stepIndex >= orderedSteps.indexOf('round-2-contract-bid')

  return {
    ...(isSequentialPhase(phase) ? { activePlayerId: state.playerId } : {}),
    dueAt: null,
    finalScientificModelProgress: phase === 'final-scientific-model'
      ? { completed: 1, total: 2 }
      : undefined,
    knownSignals: samples,
    modelAnalysisProgress: phase === 'model-analysis'
      ? { completed: 1, total: 2 }
      : undefined,
    phase,
    players: [
      {
        ...(state.step !== 'round-1-access' && state.step !== 'round-2-access'
          ? { accessSlot: state.round === 1 ? 5 : 4, requestedAccessSlot: state.round === 1 ? 5 : 4 }
          : {}),
        ...(hasConfirmedPower ? { powerAllocation: currentPower, powerAllocationConfirmed: true } : {}),
        budget: state.budget,
        contractPowerRestriction: 0,
        corporateTrust: state.corporateTrust,
        displayName: translate('tutorial.player.you'),
        playerId: state.playerId,
        rating: state.rating,
        tiePriority: 1,
      },
      {
        ...(state.step !== 'round-1-access' && state.step !== 'round-2-access'
          ? { accessSlot: state.round === 1 ? 2 : 3, requestedAccessSlot: state.round === 1 ? 2 : 3 }
          : {}),
        ...(hasConfirmedPower ? { powerAllocation: currentPower, powerAllocationConfirmed: true } : {}),
        budget: 2,
        contractPowerRestriction: 0,
        corporateTrust: 0,
        displayName: translate('tutorial.player.opponent'),
        playerId: 'tutorial-opponent',
        rating: 0,
        tiePriority: 2,
      },
    ],
    privateFinalScientificModelDraft: phase === 'final-scientific-model'
      ? {
        signals: {
          aster: { fieldType: 'inertial', polarity: 'positive' },
          boreal: { fieldType: 'electromagnetic', polarity: 'positive' },
        },
      }
      : undefined,
    privateMeasurements: hasRoundOneTest
      ? [{ receiverSignal: 'boreal', sourceSignal: 'aster', polarityRelation: 'same' }]
      : [],
    privateRawTelemetrySignals: [],
    privateResearchCertifications: [
      ...(hasAsterThesis ? ['aster' as const] : []),
      ...(hasBorealThesis ? ['boreal' as const] : []),
    ],
    privateSamples: samples,
    privateTheses: state.privateTheses,
    privateUsedContractEvidenceTestIds: [],
    privateWorkingModel: state.workingModel,
    publicContracts: contractVisible ? [{
      contractId: tutorialContractId,
      eligibleForPlayer: hasRoundTwoTest,
      kind: 'light',
      planning: {
        eligible: hasRoundTwoTest,
        missingConditions: hasRoundTwoTest ? [] : ['evidence'],
        requiredPower: 1,
        suitableEvidenceSelections: hasRoundTwoTest ? [['tutorial-test-2']] : [],
        suitableEvidenceTestIds: hasRoundTwoTest ? ['tutorial-test-2'] : [],
        suitableResearchCertificationSignals: [],
      },
      ratingReward: 2,
      requiredPublicResult: 'unstable_collapse',
      ...(contractReserved ? { reservedByPlayerId: state.playerId } : {}),
      targetRole: 'source',
      targetSignal: 'boreal',
    }] : [],
    publicLaboratoryResults: journal.map((entry) => ({
      playerId: entry.playerId,
      protocol: entry.protocol,
      publicResult: entry.publicResult,
      receiverSignal: entry.receiverSignal,
      sourceSignal: entry.sourceSignal,
    })),
    publicScientificJournal: journal,
    publicTheses: [],
    round: state.round,
    ruleset: 'tender-v2',
    sequentialPhaseProgress: isSequentialPhase(phase) ? { completed: 1, total: 2 } : undefined,
    serverTime: '2026-08-04T12:00:00.000Z',
    tenderId: 'tutorial',
    version: stepIndex,
  }
}

function phaseForStep(step: TutorialStep): TenderPhase {
  if (step.endsWith('access')) return 'access-slot-selection'
  if (step.endsWith('power')) return 'power-allocation'
  if (step.endsWith('recon')) return 'reconnaissance'
  if (step.endsWith('lab')) return 'laboratory'
  if (step === 'round-2-contract-reserve' || step === 'round-2-contract-bid') return 'contracts'
  if (step === 'final-model') return 'final-scientific-model'
  if (step === 'complete') return 'complete'
  return 'model-analysis'
}

function isSequentialPhase(phase: TenderPhase) {
  return phase === 'reconnaissance' || phase === 'laboratory' || phase === 'contracts'
}
