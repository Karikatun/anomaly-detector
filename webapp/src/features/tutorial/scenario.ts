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
  | 'prologue'
  | 'interaction-guide'
  | 'round-1-header'
  | 'round-1-sidebar'
  | 'round-1-contracts'
  | 'round-1-access-intro'
  | 'round-1-access'
  | 'round-1-power-intro'
  | 'round-1-power'
  | 'round-1-recon-intro'
  | 'round-1-recon'
  | 'round-1-lab-intro'
  | 'round-1-lab-mode'
  | 'round-1-lab-pair'
  | 'research-results'
  | 'research-results-open'
  | 'help-menu'
  | 'interpretation'
  | 'interpretation-open'
  | 'round-1-model-intro'
  | 'round-1-working-model'
  | 'round-1-thesis'
  | 'round-1-thesis-result'
  | 'round-1-thesis-result-open'
  | 'round-2-access'
  | 'round-2-contracts-review'
  | 'round-2-contracts-review-open'
  | 'round-2-power'
  | 'round-2-recon'
  | 'round-2-lab'
  | 'round-2-working-model'
  | 'round-2-thesis'
  | 'round-2-contracts-intro'
  | 'round-2-contract-reserve'
  | 'round-2-contract-bid'
  | 'final-model-intro'
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
  | { type: 'start-tutorial' }
  | { type: 'continue' }
  | { type: 'select-laboratory-mode'; mode: 'broad' | 'deep' }
  | { type: 'open-help-menu' }
  | { type: 'open-interpretation' }
  | { type: 'open-interpretation-direct' }
  | { type: 'close-interpretation' }
  | { type: 'open-research-results' }
  | { type: 'close-research-results' }
  | { type: 'open-contracts-review' }
  | { type: 'close-contracts-review' }

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
    step: 'prologue',
    thesisAttempts: 0,
    workingModel: { signals: {} },
  }
}

export function advanceTutorial(
  state: TutorialState,
  action: TutorialAction,
): TutorialAdvanceResult {
  switch (state.step) {
    case 'prologue':
      return action.type === 'start-tutorial'
        ? progressed(state, { step: 'interaction-guide' })
        : unchanged(state)
    case 'interaction-guide':
      return continueTo(state, action, 'round-1-header')
    case 'round-1-header':
      return continueTo(state, action, 'round-1-sidebar')
    case 'round-1-sidebar':
      return continueTo(state, action, 'round-1-contracts')
    case 'round-1-contracts':
      return continueTo(state, action, 'round-1-access-intro')
    case 'round-1-access-intro':
      return continueTo(state, action, 'round-1-access')
    case 'round-1-access':
      return action.type === 'request-access-slot' && action.slot === 5
        ? progressed(state, { step: 'round-1-power-intro' })
        : unchanged(state)
    case 'round-1-power-intro':
      return continueTo(state, action, 'round-1-power')
    case 'round-1-power':
      return action.type === 'allocate-power' && allocationMatches(action.allocation, [1, 2, 1, 0])
        ? progressed(state, { step: 'round-1-recon-intro' })
        : unchanged(state)
    case 'round-1-recon-intro':
      return continueTo(state, action, 'round-1-recon')
    case 'round-1-recon':
      return isUnknownRecon(action)
        ? progressed(state, { step: 'round-1-lab-intro' })
        : unchanged(state)
    case 'round-1-lab-intro':
      return continueTo(state, action, 'round-1-lab-mode')
    case 'round-1-lab-mode':
      return action.type === 'select-laboratory-mode' && action.mode === 'deep'
        ? progressed(state, { step: 'round-1-lab-pair' })
        : unchanged(state)
    case 'round-1-lab-pair':
      return action.type === 'run-laboratory-test'
        && 'laboratory' in action
        && action.laboratory.mode === 'deep'
        && pairMatches(action.laboratory.pair, 'aster', 'boreal')
        ? progressed(state, { step: 'research-results' })
        : unchanged(state)
    case 'research-results':
      return action.type === 'open-research-results'
        ? progressed(state, { step: 'research-results-open' })
        : unchanged(state)
    case 'research-results-open':
      return action.type === 'close-research-results'
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
        ? progressed(state, { step: 'round-1-model-intro' })
        : unchanged(state)
    case 'round-1-model-intro':
      return continueTo(state, action, 'round-1-working-model')
    case 'round-1-working-model':
      return action.type === 'update-working-model'
        && hypothesisMatches(action.workingModel, 'aster')
        ? progressed(state, { step: 'round-1-thesis', workingModel: action.workingModel })
        : unchanged(state)
    case 'round-1-thesis':
      return resolveThesis(state, action, 'aster', 'round-1-thesis-result')
    case 'round-1-thesis-result':
      return action.type === 'open-research-results'
        ? progressed(state, { step: 'round-1-thesis-result-open' })
        : unchanged(state)
    case 'round-1-thesis-result-open':
      return action.type === 'close-research-results'
        ? progressed(state, { round: 2, step: 'round-2-access' })
        : unchanged(state)
    case 'round-2-access':
      return action.type === 'request-access-slot' && action.slot === 4
        ? progressed(state, { budget: state.budget + 1, step: 'round-2-contracts-review' })
        : unchanged(state)
    case 'round-2-contracts-review':
      return action.type === 'open-contracts-review'
        ? progressed(state, { step: 'round-2-contracts-review-open' })
        : unchanged(state)
    case 'round-2-contracts-review-open':
      return action.type === 'close-contracts-review'
        ? progressed(state, { step: 'round-2-power' })
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
      return resolveThesis(state, action, 'boreal', 'round-2-contracts-intro')
    case 'round-2-contracts-intro':
      return continueTo(state, action, 'round-2-contract-reserve')
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
          step: 'final-model-intro',
        })
        : unchanged(state)
    case 'final-model-intro':
      return continueTo(state, action, 'final-model')
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
        round: state.round,
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

function continueTo(
  state: TutorialState,
  action: TutorialAction,
  step: TutorialStep,
): TutorialAdvanceResult {
  return action.type === 'continue' ? progressed(state, { step }) : unchanged(state)
}

const orderedSteps: TutorialStep[] = [
  'prologue',
  'interaction-guide',
  'round-1-header',
  'round-1-sidebar',
  'round-1-contracts',
  'round-1-access-intro',
  'round-1-access',
  'round-1-power-intro',
  'round-1-power',
  'round-1-recon-intro',
  'round-1-recon',
  'round-1-lab-intro',
  'round-1-lab-mode',
  'round-1-lab-pair',
  'research-results',
  'research-results-open',
  'help-menu',
  'interpretation',
  'interpretation-open',
  'round-1-model-intro',
  'round-1-working-model',
  'round-1-thesis',
  'round-1-thesis-result',
  'round-1-thesis-result-open',
  'round-2-access',
  'round-2-contracts-review',
  'round-2-contracts-review-open',
  'round-2-power',
  'round-2-recon',
  'round-2-lab',
  'round-2-working-model',
  'round-2-thesis',
  'round-2-contracts-intro',
  'round-2-contract-reserve',
  'round-2-contract-bid',
  'final-model-intro',
  'final-model',
  'complete',
]

export function tutorialView(state: TutorialState): TenderView {
  const phase = phaseForStep(state.step)
  const stepIndex = orderedSteps.indexOf(state.step)
  const hasRoundOneSample = stepIndex >= orderedSteps.indexOf('round-1-power-intro')
  const hasBoreal = stepIndex >= orderedSteps.indexOf('round-1-lab-intro')
  const hasRoundOneTest = stepIndex >= orderedSteps.indexOf('research-results')
  const hasAsterThesis = stepIndex >= orderedSteps.indexOf('round-1-thesis-result')
  const hasCinder = stepIndex >= orderedSteps.indexOf('round-2-lab')
  const hasRoundTwoTest = stepIndex >= orderedSteps.indexOf('round-2-working-model')
  const hasBorealThesis = stepIndex >= orderedSteps.indexOf('round-2-contracts-intro')
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
  const hasConfirmedPower = state.round === 1
    ? stepIndex >= orderedSteps.indexOf('round-1-recon-intro')
    : stepIndex >= orderedSteps.indexOf('round-2-recon')
  const currentPower = state.round === 1 ? roundOnePower : roundTwoPower
  const hasConfirmedAccessSlot = state.round === 1
    ? stepIndex >= orderedSteps.indexOf('round-1-power-intro')
    : stepIndex >= orderedSteps.indexOf('round-2-contracts-review')
  const samples: SignalId[] = [
    ...(hasRoundOneSample ? ['aster' as const] : []),
    ...(hasBoreal ? ['boreal' as const] : []),
    ...(hasCinder ? ['cinder' as const] : []),
  ]
  const knownSignals = [...new Set<SignalId>(['aster', 'boreal', ...samples])]
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
  const contractReserved = stepIndex >= orderedSteps.indexOf('round-2-contract-bid')

  return {
    ...(isSequentialPhase(phase) ? { activePlayerId: state.playerId } : {}),
    dueAt: null,
    finalScientificModelProgress: phase === 'final-scientific-model'
      ? { completed: 1, total: 2 }
      : undefined,
    knownSignals,
    modelAnalysisProgress: phase === 'model-analysis'
      ? { completed: 1, total: 2 }
      : undefined,
    phase,
    players: [
      {
        ...(hasConfirmedAccessSlot
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
        ...(hasConfirmedAccessSlot
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
    publicContracts: [{
      contractId: 'tutorial-ready-contract',
      eligibleForPlayer: hasRoundOneTest,
      kind: 'light',
      planning: {
        eligible: hasRoundOneTest,
        missingConditions: hasRoundOneTest ? [] : ['evidence'],
        requiredPower: 1,
        suitableEvidenceSelections: hasRoundOneTest ? [['tutorial-test-1']] : [],
        suitableEvidenceTestIds: hasRoundOneTest ? ['tutorial-test-1'] : [],
        suitableResearchCertificationSignals: [],
      },
      ratingReward: 2,
      requiredPublicResult: 'reflection',
      targetRole: 'source',
      targetSignal: 'aster',
    }, {
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
    }],
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
  if (step === 'prologue'
    || step === 'interaction-guide'
    || step.startsWith('round-1-header')
    || step.startsWith('round-1-sidebar')
    || step.startsWith('round-1-contracts')
    || step.startsWith('round-1-access')) return 'access-slot-selection'
  if (step === 'round-1-power-intro') return 'power-allocation'
  if (step === 'round-1-recon-intro') return 'reconnaissance'
  if (step === 'round-1-lab-intro'
    || step === 'round-1-lab-mode'
    || step === 'round-1-lab-pair') return 'laboratory'
  if (step === 'research-results' || step === 'research-results-open') return 'laboratory'
  if (step === 'round-1-model-intro') return 'model-analysis'
  if (step === 'round-1-thesis-result' || step === 'round-1-thesis-result-open') return 'model-analysis'
  if (step === 'round-2-contracts-review' || step === 'round-2-contracts-review-open') return 'power-allocation'
  if (step === 'round-2-contracts-intro') return 'contracts'
  if (step === 'final-model-intro') return 'final-scientific-model'
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
