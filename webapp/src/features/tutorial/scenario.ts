import { powerAllocationSchema, scientificModelSchema } from '@anomaly-detector/contracts'
import type { FieldType, Polarity, PowerAllocation, PrivateThesis, ScientificJournalEntry, ScientificModel, ScientificModelDraft, SignalId, TenderPhase, TenderView, WorkingModel } from '@anomaly-detector/contracts'
import type { TenderCommandInput } from '@/features/tender/public/tutorial-board'
import { translate } from '@/platform/i18n'

export const baseScenarioVersion = 'base-simple-v1' as const
export const tutorialPowerGoals = {
  'round-1-power': [1, 2, 1, 0],
} as const

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
  | 'round-2-research'
  | 'round-2-research-open'
  | 'round-2-working-model'
  | 'round-2-thesis'
  | 'round-2-contracts-intro'
  | 'round-2-contract-reserve'
  | 'round-2-contract-bid'
  | 'final-model-intro'
  | 'final-model'
  | 'complete'
  | 'round-2-thesis-result'
  | 'round-3-access'
  | 'round-3-power'
  | 'round-3-recon'
  | 'round-3-lab'
  | 'round-3-thesis'

export type TutorialState = {
  lessonId: 'base'
  scenarioVersion: typeof baseScenarioVersion
  playerId: string
  round: 1 | 2 | 3
  step: TutorialStep
  budget: number
  corporateTrust: number
  rating: number
  hintLevel: number
  thesisAttempts: number
  corporateReviewActive: boolean
  independentCycle: boolean
  accessSlot: number | null
  allocation: PowerAllocation | null
  samples: SignalId[]
  samplePool: SignalId[]
  journal: ScientificJournalEntry[]
  privateMeasurements: TenderView['privateMeasurements']
  privateTheses: PrivateThesis[]
  workingModel: WorkingModel
  finalDraft: ScientificModelDraft | null
  finalSubmission: ScientificModel | null
}

export type TutorialUiAction =
  | { type: 'start-tutorial' }
  | { type: 'continue' }
  | { type: 'restart-exercise' }
  | { type: 'request-hint' }
  | { type: 'select-laboratory-mode'; mode: 'broad' | 'deep' }
  | { type: 'open-help-menu' }
  | { type: 'open-interpretation' }
  | { type: 'open-interpretation-direct' }
  | { type: 'open-working-model' }
  | { type: 'close-interpretation' }
  | { type: 'open-research-results' }
  | { type: 'close-research-results' }
  | { type: 'close-journal'; workingModel: WorkingModel }
  | { type: 'open-contracts-review' }
  | { type: 'close-contracts-review' }
export type TutorialAction = TenderCommandInput | TutorialUiAction
export type TutorialAdvanceResult = {
  progressed: boolean
  state: TutorialState
  thesisFeedback?: { fieldTypeCorrect: boolean; polarityCorrect: boolean }
}

const signalIds: SignalId[] = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro']
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
    lessonId: 'base', scenarioVersion: baseScenarioVersion, playerId, round: 1, step: 'prologue',
    budget: 2, corporateTrust: 0, rating: 0, hintLevel: 0, thesisAttempts: 0,
    corporateReviewActive: false, independentCycle: false, accessSlot: null, allocation: null,
    samples: [], samplePool: [...signalIds], journal: [], privateMeasurements: [], privateTheses: [],
    workingModel: { signals: {} }, finalDraft: null, finalSubmission: null,
  }
}

export function resumeTutorialState(state: TutorialState): TutorialState {
  // Dialog visibility is ephemeral; a restored lesson must offer its real entry.
  const step = state.step === 'research-results-open' ? 'research-results'
    : state.step === 'interpretation-open' ? 'interpretation' : state.step
  // Before the lesson was shortened, the first-round result did not set this flag.
  const independentCycle = state.independentCycle || (
    state.round === 1 && step === 'round-1-thesis-result'
    && state.privateTheses.some((thesis) => thesis.round === 1 && thesis.signalId === 'aster' && thesis.fullyCorrect)
  )
  return step === state.step && independentCycle === state.independentCycle ? state : { ...state, step, independentCycle }
}
const unchanged = (state: TutorialState): TutorialAdvanceResult => ({ progressed: false, state })
const progressed = (state: TutorialState, changes: Partial<TutorialState>): TutorialAdvanceResult => ({ progressed: true, state: { ...state, ...changes } })

export function advanceTutorial(state: TutorialState, action: TutorialAction): TutorialAdvanceResult {
  // Older completed lessons can still be displayed and handed off to an account.
  if (state.round !== 1 || state.step === 'complete') return unchanged(state)
  if (action.type === 'close-journal' && state.step !== 'final-model') state = { ...state, workingModel: action.workingModel }
  if (action.type === 'update-working-model' && state.step !== 'final-model') {
    return { progressed: false, state: { ...state, workingModel: action.workingModel } }
  }
  if (action.type === 'request-hint') return { progressed: false, state: { ...state, hintLevel: Math.min(2, state.hintLevel + 1) } }
  if (action.type === 'restart-exercise' && state.step === 'round-1-thesis') {
    const signals = { ...state.workingModel.signals }
    delete signals.aster
    return progressed(state, {
      privateTheses: [], thesisAttempts: 0, corporateReviewActive: false,
      hintLevel: 0, workingModel: { signals }, step: 'round-1-working-model',
    })
  }
  if (action.type === 'submit-thesis') return resolveThesis(state, action)
  if (action.type === 'update-scientific-model-draft' && state.step === 'final-model') {
    return { progressed: false, state: { ...state, finalDraft: action.scientificModelDraft } }
  }
  if (action.type === 'submit-scientific-model' && state.step === 'final-model' && state.independentCycle) {
    const parsed = scientificModelSchema.safeParse(action.scientificModel)
    if (!parsed.success) return unchanged(state)
    const rating = Object.entries(parsed.data.signals).reduce((score, [id, claim]) => {
      const actual = signalProperties[id as SignalId]
      return score + Number(claim?.fieldType === actual.fieldType) + Number(claim?.polarity === actual.polarity)
    }, 0)
    return progressed(state, { step: 'complete', rating, finalSubmission: parsed.data })
  }
  if (action.type === 'request-access-slot' && state.step === 'round-1-access') {
    if (action.slot !== 6) return unchanged(state)
    const samples = state.samples.includes('boreal') ? state.samples : [...state.samples, 'boreal' as const]
    return progressed(state, { step: 'round-1-power', accessSlot: action.slot, budget: state.budget + 1, samples })
  }
  if (action.type === 'allocate-power' && state.step === 'round-1-power') {
    const parsed = powerAllocationSchema.safeParse(action.allocation)
    if (!parsed.success) return unchanged(state)
    const allocation = parsed.data
    const [reconnaissance, laboratory, modelAnalysis, contracts] = tutorialPowerGoals['round-1-power']
    if (allocation.reconnaissance !== reconnaissance || allocation.laboratory !== laboratory
      || allocation.modelAnalysis !== modelAnalysis || allocation.contracts !== contracts) return unchanged(state)
    return progressed(state, { step: 'round-1-recon', allocation })
  }
  if (action.type === 'conduct-reconnaissance' && state.step === 'round-1-recon') {
    const targets = action.targets ?? action.signals ?? []
    if (targets.length !== 1 || targets[0] !== 'aster' || targets.length !== state.allocation?.reconnaissance
      || state.samples.includes('aster') || !state.samplePool.includes('aster')) return unchanged(state)
    return progressed(state, {
      step: 'round-1-lab-mode',
      samples: [...state.samples, 'aster'],
      samplePool: state.samplePool.filter((signal) => signal !== 'aster'),
    })
  }
  if (action.type === 'run-laboratory-test' && state.step === 'round-1-lab-pair') return runTest(state, action)
  switch (state.step) {
    case 'prologue': return action.type === 'start-tutorial' ? progressed(state, { step: 'round-1-access' }) : unchanged(state)
    case 'round-1-lab-mode': return action.type === 'select-laboratory-mode' && action.mode === 'deep' ? progressed(state, { step: 'round-1-lab-pair' }) : unchanged(state)
    case 'research-results': return action.type === 'open-research-results' ? progressed(state, { step: 'research-results-open' }) : unchanged(state)
    case 'research-results-open': return action.type === 'open-interpretation' ? progressed(state, { step: 'interpretation-open' }) : closeTo(state, action, 'research-results')
    case 'interpretation': return action.type === 'open-interpretation' || action.type === 'open-interpretation-direct' ? progressed(state, { step: 'interpretation-open' }) : unchanged(state)
    case 'interpretation-open': return action.type === 'open-working-model' ? progressed(state, { step: 'round-1-working-model' }) : closeTo(state, action, 'interpretation')
    case 'round-1-working-model': return closeHypothesis(state, action)
    case 'round-1-thesis-result': return action.type === 'continue' && state.independentCycle ? enterFinal(state) : unchanged(state)
    default: return unchanged(state)
  }
}

function closeTo(state: TutorialState, action: TutorialAction, step: TutorialStep) {
  return ['close-journal', 'close-research-results', 'close-interpretation'].includes(action.type) ? progressed(state, { step }) : unchanged(state)
}
function closeHypothesis(state: TutorialState, action: TutorialAction) {
  const hypothesis = state.workingModel.signals.aster?.hypothesis
  return ['close-journal', 'close-research-results'].includes(action.type) && hypothesis?.fieldType && hypothesis.polarity
    ? progressed(state, { step: 'round-1-thesis' }) : unchanged(state)
}
function enterFinal(state: TutorialState): TutorialAdvanceResult {
  const signals = Object.fromEntries(Object.entries(state.workingModel.signals).flatMap(([id, model]) => model.hypothesis && (model.hypothesis.fieldType || model.hypothesis.polarity) ? [[id, { ...model.hypothesis }]] : []))
  return progressed(state, { step: 'final-model', budget: state.budget + 1, finalDraft: { signals } })
}
function runTest(state: TutorialState, action: Extract<TutorialAction, { type: 'run-laboratory-test' }>): TutorialAdvanceResult {
  if (!('laboratory' in action) || action.laboratory.mode !== 'deep' || state.allocation?.laboratory !== 2) return unchanged(state)
  const pair = action.laboratory.pair
  const { sourceSignal, receiverSignal } = pair
  if (sourceSignal !== 'aster' || receiverSignal !== 'boreal'
    || !state.samples.includes(sourceSignal) || !state.samples.includes(receiverSignal)) return unchanged(state)
  if (state.journal.some((entry) => entry.sourceSignal === sourceSignal && entry.receiverSignal === receiverSignal && entry.protocol === 'continuous')) return unchanged(state)
  const entry: ScientificJournalEntry = {
    ...pair, playerId: state.playerId, protocol: 'continuous',
    publicResult: fixtureResult(sourceSignal, receiverSignal), testId: `base-r1-${state.journal.length + 1}`,
  }
  const polarityRelation = signalProperties[sourceSignal].polarity === signalProperties[receiverSignal].polarity ? 'same' : 'different'
  return progressed(state, {
    step: 'research-results',
    journal: [...state.journal, entry],
    privateMeasurements: [...state.privateMeasurements, { ...pair, polarityRelation }],
  })
}
function fixtureResult(source: SignalId, receiver: SignalId): ScientificJournalEntry['publicResult'] {
  const a = signalProperties[source], b = signalProperties[receiver]
  const same = a.polarity === b.polarity
  if (a.fieldType === b.fieldType) return same ? 'transmission_gain' : 'attenuation'
  const types: FieldType[] = ['inertial', 'electromagnetic', 'phase']
  const forward = (types.indexOf(a.fieldType) + 1) % 3 === types.indexOf(b.fieldType)
  return forward ? same ? 'reflection' : 'unstable_collapse' : same ? 'attenuation' : 'transmission_gain'
}
function resolveThesis(state: TutorialState, action: Extract<TutorialAction, { type: 'submit-thesis' }>): TutorialAdvanceResult {
  if (state.step !== 'round-1-thesis' || action.signalId !== 'aster' || !state.samples.includes(action.signalId)) return unchanged(state)
  const attempts = state.privateTheses.length
  if (attempts >= (state.allocation?.modelAnalysis ?? 0) || (state.corporateReviewActive && state.budget < 1)) return unchanged(state)
  const actual = signalProperties[action.signalId]
  const thesisFeedback = { fieldTypeCorrect: action.fieldType === actual.fieldType, polarityCorrect: action.polarity === actual.polarity }
  const fullyCorrect = thesisFeedback.fieldTypeCorrect && thesisFeedback.polarityCorrect
  const thesis: PrivateThesis = { id: `base-r1-thesis-${attempts + 1}`, signalId: action.signalId, fieldType: action.fieldType, polarity: action.polarity, ...thesisFeedback, fullyCorrect, round: 1 }
  const next = { ...state, budget: state.budget - Number(state.corporateReviewActive), corporateReviewActive: state.corporateReviewActive || !fullyCorrect, thesisAttempts: attempts + 1, privateTheses: [...state.privateTheses, thesis] }
  if (fullyCorrect) return { ...progressed(next, { step: 'round-1-thesis-result', independentCycle: true }), thesisFeedback }
  return { progressed: false, state: next, thesisFeedback }
}

export function tutorialView(state: TutorialState): TenderView {
  const phase = phaseForStep(state.step)
  const attempts = state.privateTheses.filter((thesis) => thesis.round === state.round).length
  const completedAnalysis = state.step.endsWith('thesis-result') || attempts >= (state.allocation?.modelAnalysis ?? 0) || (state.corporateReviewActive && state.budget < 1)
  return {
    game: { mode: 'simple', rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' },
    activePlayerId: ['reconnaissance', 'laboratory'].includes(phase) ? state.playerId : undefined,
    dueAt: null, knownSignals: [...signalIds], availableSamplePool: state.samplePool,
    corporateReviewActive: state.corporateReviewActive,
    phase, players: [{
      playerId: state.playerId, displayName: translate('tutorial.player.you'), tiePriority: 1,
      budget: state.budget, corporateTrust: 0, rating: state.rating, contractPowerRestriction: 0,
      ...(state.accessSlot !== null ? { accessSlot: state.accessSlot, requestedAccessSlot: state.accessSlot } : {}),
      ...(state.allocation ? { powerAllocation: state.allocation, powerAllocationConfirmed: true } : {}),
      ...(phase === 'model-analysis' ? { modelAnalysisCompleted: completedAnalysis } : {}),
    }, { playerId: 'tutorial-opponent', displayName: translate('tutorial.player.opponent'), tiePriority: 2, budget: 2, corporateTrust: 0, rating: 0, contractPowerRestriction: 0 }],
    privateSamples: state.samples, privateRawTelemetrySignals: [], privateMeasurements: state.privateMeasurements,
    privateWorkingModel: state.workingModel, privateTheses: state.privateTheses,
    privateResearchCertifications: [], privateUsedContractEvidenceTestIds: [],
    ...(state.finalDraft ? { privateFinalScientificModelDraft: state.finalDraft } : {}),
    ...(state.finalSubmission ? { privateFinalScientificModelSubmission: { scientificModel: state.finalSubmission, submittedAt: '2026-11-03T00:00:00.000Z' } } : {}),
    publicContracts: [], publicLaboratoryResults: state.journal.map((entry) => ({ playerId: entry.playerId, protocol: entry.protocol, publicResult: entry.publicResult, sourceSignal: entry.sourceSignal, receiverSignal: entry.receiverSignal })), publicScientificJournal: state.journal, publicTheses: [],
    round: state.round, ruleset: 'tender-v2', serverTime: '2026-11-03T00:00:00.000Z', tenderId: 'tutorial', version: state.journal.length + state.privateTheses.length,
    ...(phase === 'model-analysis' ? { modelAnalysisProgress: { completed: Number(completedAnalysis), total: 1 } } : {}),
  }
}
function phaseForStep(step: TutorialStep): TenderPhase {
  if (step === 'prologue' || step.endsWith('access')) return 'access-slot-selection'
  if (step.endsWith('power')) return 'power-allocation'
  if (step.endsWith('recon')) return 'reconnaissance'
  if (step.includes('lab-mode') || step.includes('lab-pair') || step.endsWith('lab')) return 'laboratory'
  if (step === 'final-model') return 'final-scientific-model'
  if (step === 'complete') return 'complete'
  return 'model-analysis'
}
