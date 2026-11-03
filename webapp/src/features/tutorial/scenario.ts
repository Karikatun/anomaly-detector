import { powerAllocationSchema, scientificModelSchema } from '@anomaly-detector/contracts'
import type { FieldType, Polarity, PowerAllocation, PrivateThesis, ScientificJournalEntry, ScientificModel, ScientificModelDraft, SignalId, TenderPhase, TenderView, WorkingModel } from '@anomaly-detector/contracts'
import type { TenderCommandInput } from '@/features/tender/public/tutorial-board'
import { translate } from '@/platform/i18n'

export const baseScenarioVersion = 'base-simple-v1' as const
// Kept for bounded decoding of the former lesson; the base lesson has no Contracts.
export const tutorialContractId = 'tutorial-light-contract'
export const tutorialPowerGoals = {
  'round-1-power': [1, 2, 1, 0],
  'round-2-power': [0, 1, 2, 0],
  'round-3-power': [0, 1, 1, 0],
} as const

export type TutorialStep =| 'prologue'
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
  | 'complete'  | 'round-2-thesis-result'
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
    : state.step === 'interpretation-open' ? 'interpretation'
      : state.step === 'round-2-research-open' ? 'round-2-research' : state.step
  return step === state.step ? state : { ...state, step }
}
const unchanged = (state: TutorialState): TutorialAdvanceResult => ({ progressed: false, state })
const progressed = (state: TutorialState, changes: Partial<TutorialState>): TutorialAdvanceResult => ({ progressed: true, state: { ...state, ...changes } })

export function advanceTutorial(state: TutorialState, action: TutorialAction): TutorialAdvanceResult {
  if (action.type === 'close-journal' && !['final-model', 'complete'].includes(state.step)) state = { ...state, workingModel: action.workingModel }
  if (action.type === 'update-working-model' && !['final-model', 'complete'].includes(state.step)) {
    return { progressed: false, state: { ...state, workingModel: action.workingModel } }
  }
  if (action.type === 'request-hint') return { progressed: false, state: { ...state, hintLevel: Math.min(2, state.hintLevel + 1) } }
  if (action.type === 'restart-exercise' && state.step.endsWith('thesis') && state.round < 3) {
    const target = state.round === 1 ? 'aster' : 'cinder'
    const privateTheses = state.privateTheses.filter((thesis) => thesis.round !== state.round)
    const spentOnReview = state.privateTheses.filter((thesis) => thesis.round === state.round).slice(1).length
    const signals = { ...state.workingModel.signals }
    delete signals[target]
    return progressed(state, {
      privateTheses, budget: state.budget + spentOnReview, thesisAttempts: 0, corporateReviewActive: false,
      hintLevel: 0, workingModel: { signals }, step: state.round === 1 ? 'round-1-working-model' : 'round-2-working-model',
    })
  }
  if (action.type === 'finish-model-analysis' && state.step === 'round-3-thesis' && state.allocation?.modelAnalysis === 2 && state.privateTheses.filter((thesis) => thesis.round === 3).length === 1) return enterFinal(state)
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
  if (action.type === 'request-access-slot' && state.step.endsWith('access')) {
    const required = state.round === 1 ? 6 : state.round === 2 ? 5 : null
    const delta = action.slot === 1 ? -2 : action.slot === 2 ? -1 : [4, 6].includes(action.slot) ? 1 : 0
    if ((required !== null && action.slot !== required) || state.budget + delta < 0) return unchanged(state)
    const samples = [...state.samples]
    if ([5, 6].includes(action.slot)) {
      const next = state.round === 1 ? 'boreal' : state.round === 2 ? 'cinder' : signalIds.find((id) => !samples.includes(id))
      if (next && !samples.includes(next)) samples.push(next)
    }
    return progressed(state, { step: `round-${state.round}-power`, accessSlot: action.slot, budget: state.budget + delta, samples })
  }
  if (action.type === 'allocate-power' && state.step.endsWith('power')) {
    const parsed = powerAllocationSchema.safeParse(action.allocation)
    if (!parsed.success || parsed.data.contracts !== 0 || parsed.data.reconnaissance > 6 - state.samples.length) return unchanged(state)
    const allocation = parsed.data
    if (allocation.laboratory > 0 && state.samples.length + allocation.reconnaissance < 2) return unchanged(state)
    if (state.round === 1 && !(allocation.reconnaissance === 1 && allocation.laboratory === 2 && allocation.modelAnalysis === 1)) return unchanged(state)
    if (state.round === 2 && !(allocation.reconnaissance === 0 && allocation.laboratory === 1 && allocation.modelAnalysis === 2 && allocation.reserve === 1)) return unchanged(state)
    const next = { ...state, allocation }
    if (allocation.reconnaissance) return progressed(next, { step: state.round === 1 ? 'round-1-recon' : 'round-3-recon' })
    return afterReconnaissance(next)
  }
  if (action.type === 'conduct-reconnaissance' && state.step.endsWith('recon')) {
    const targets = action.targets ?? action.signals ?? []
    if (targets.length !== state.allocation?.reconnaissance) return unchanged(state)
    if (state.round === 1 && !(targets.length === 1 && targets[0] === 'aster')) return unchanged(state)
    const samples = [...state.samples]
    let samplePool = [...state.samplePool]
    for (const target of targets) {
      const id = target === 'unknown-sector' ? signalIds.find((candidate) => !samples.includes(candidate)) : target
      if (!id || samples.includes(id) || (target !== 'unknown-sector' && !samplePool.includes(id))) return unchanged(state)
      samples.push(id)
      if (target !== 'unknown-sector') samplePool = samplePool.filter((candidate) => candidate !== id)
    }
    return afterReconnaissance({ ...state, samples, samplePool })
  }
  if (action.type === 'run-laboratory-test' && ['round-1-lab-pair', 'round-2-lab', 'round-3-lab'].includes(state.step)) return runTest(state, action)
  switch (state.step) {
    case 'prologue': return action.type === 'start-tutorial' ? progressed(state, { step: 'round-1-access' }) : unchanged(state)
    case 'round-1-lab-mode': return action.type === 'select-laboratory-mode' && action.mode === 'deep' ? progressed(state, { step: 'round-1-lab-pair' }) : unchanged(state)
    case 'research-results': return action.type === 'open-research-results' ? progressed(state, { step: 'research-results-open' }) : unchanged(state)
    case 'research-results-open': return action.type === 'open-interpretation' ? progressed(state, { step: 'interpretation-open' }) : closeTo(state, action, 'research-results')
    case 'interpretation': return action.type === 'open-interpretation' || action.type === 'open-interpretation-direct' ? progressed(state, { step: 'interpretation-open' }) : unchanged(state)
    case 'interpretation-open': return action.type === 'open-working-model' ? progressed(state, { step: 'round-1-working-model' }) : closeTo(state, action, 'interpretation')
    case 'round-1-working-model': return closeHypothesis(state, action, 'aster', 'round-1-thesis')
    case 'round-2-working-model': return closeHypothesis(state, action, 'cinder', 'round-2-thesis')
    case 'round-2-research': return action.type === 'open-research-results' ? progressed(state, { step: 'round-2-research-open' }) : unchanged(state)
    case 'round-2-research-open': return action.type === 'open-working-model' ? progressed(state, { step: 'round-2-working-model' }) : closeTo(state, action, 'round-2-research')
    case 'round-1-thesis-result': return action.type === 'continue' ? nextRound(state, 2) : unchanged(state)
    case 'round-2-thesis-result': return action.type === 'continue' || action.type === 'finish-model-analysis' ? nextRound(state, 3) : unchanged(state)
    default: return unchanged(state)
  }
}

function closeTo(state: TutorialState, action: TutorialAction, step: TutorialStep) {
  return ['close-journal', 'close-research-results', 'close-interpretation'].includes(action.type) ? progressed(state, { step }) : unchanged(state)
}
function closeHypothesis(state: TutorialState, action: TutorialAction, signal: SignalId, step: TutorialStep) {
  const model = action.type === 'close-journal' ? action.workingModel : state.workingModel
  const hypothesis = model.signals[signal]?.hypothesis
  return ['close-journal', 'close-research-results'].includes(action.type) && hypothesis?.fieldType && hypothesis.polarity
    ? progressed(state, { step, workingModel: model }) : unchanged(state)
}
function nextRound(state: TutorialState, round: 2 | 3) {
  return progressed(state, { round, step: `round-${round}-access`, budget: state.budget + 1, accessSlot: null, allocation: null, corporateReviewActive: false, thesisAttempts: 0, hintLevel: 0, samplePool: [...signalIds] })
}
function afterReconnaissance(state: TutorialState): TutorialAdvanceResult {
  if (state.allocation?.laboratory) return progressed(state, { step: state.round === 1 ? 'round-1-lab-mode' : state.round === 2 ? 'round-2-lab' : 'round-3-lab' })
  return afterLaboratory(state)
}
function enterFinal(state: TutorialState): TutorialAdvanceResult {
  const signals = Object.fromEntries(Object.entries(state.workingModel.signals).flatMap(([id, model]) => model.hypothesis && (model.hypothesis.fieldType || model.hypothesis.polarity) ? [[id, { ...model.hypothesis }]] : []))
  return progressed(state, { step: 'final-model', budget: state.budget + 1, finalDraft: { signals } })
}
function afterLaboratory(state: TutorialState): TutorialAdvanceResult {
  if (state.round === 1) return progressed(state, { step: 'research-results' })
  if (state.round === 2) return progressed(state, { step: 'round-2-research' })
  return state.allocation?.modelAnalysis ? progressed(state, { step: 'round-3-thesis' }) : enterFinal(state)
}
function runTest(state: TutorialState, action: Extract<TutorialAction, { type: 'run-laboratory-test' }>): TutorialAdvanceResult {
  if (!('laboratory' in action)) return unchanged(state)
  const lab = action.laboratory
  const pairs = lab.mode === 'broad' ? lab.pairs : [lab.pair]
  if ((lab.mode === 'impulse' ? 1 : 2) !== state.allocation?.laboratory) return unchanged(state)
  if (pairs.some((pair) => pair.sourceSignal === pair.receiverSignal || !state.samples.includes(pair.sourceSignal) || !state.samples.includes(pair.receiverSignal))) return unchanged(state)
  if (new Set(pairs.map((pair) => `${pair.sourceSignal}:${pair.receiverSignal}`)).size !== pairs.length) return unchanged(state)
  if (state.round === 1 && !(lab.mode === 'deep' && pairs[0]?.sourceSignal === 'aster' && pairs[0].receiverSignal === 'boreal')) return unchanged(state)
  if (state.round === 2 && !(lab.mode === 'impulse' && pairs[0]?.sourceSignal === 'boreal' && pairs[0].receiverSignal === 'cinder')) return unchanged(state)
  if (pairs.some((pair) => state.journal.some((entry) => entry.sourceSignal === pair.sourceSignal && entry.receiverSignal === pair.receiverSignal && entry.protocol === (lab.mode === 'deep' ? 'continuous' : 'impulse')))) return unchanged(state)
  const journal = pairs.map((pair, index) => ({ ...pair, playerId: state.playerId, protocol: lab.mode === 'deep' ? 'continuous' as const : 'impulse' as const, publicResult: fixtureResult(pair.sourceSignal, pair.receiverSignal), testId: `base-r${state.round}-${state.journal.length + index + 1}` }))
  const privateMeasurements = lab.mode === 'deep' ? [...state.privateMeasurements, ...pairs.map((pair) => ({ ...pair, polarityRelation: signalProperties[pair.sourceSignal].polarity === signalProperties[pair.receiverSignal].polarity ? 'same' as const : 'different' as const }))] : state.privateMeasurements
  return afterLaboratory({ ...state, journal: [...state.journal, ...journal], privateMeasurements })
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
  if (!state.step.endsWith('thesis') || !state.samples.includes(action.signalId)) return unchanged(state)
  const target = state.round === 1 ? 'aster' : state.round === 2 ? 'cinder' : action.signalId
  const attempts = state.privateTheses.filter((thesis) => thesis.round === state.round).length
  if (action.signalId !== target || attempts >= (state.allocation?.modelAnalysis ?? 0) || (state.corporateReviewActive && state.budget < 1)) return unchanged(state)
  const actual = signalProperties[action.signalId]
  const thesisFeedback = { fieldTypeCorrect: action.fieldType === actual.fieldType, polarityCorrect: action.polarity === actual.polarity }
  const fullyCorrect = thesisFeedback.fieldTypeCorrect && thesisFeedback.polarityCorrect
  const thesis: PrivateThesis = { id: `base-r${state.round}-thesis-${attempts + 1}`, signalId: action.signalId, fieldType: action.fieldType, polarity: action.polarity, ...thesisFeedback, fullyCorrect, round: state.round }
  const next = { ...state, budget: state.budget - Number(state.corporateReviewActive), corporateReviewActive: state.corporateReviewActive || !fullyCorrect, thesisAttempts: attempts + 1, privateTheses: [...state.privateTheses, thesis] }
  if (state.round === 3) return attempts + 1 < (state.allocation?.modelAnalysis ?? 0) && (!next.corporateReviewActive || next.budget >= 1) ? { progressed: false, state: next, thesisFeedback } : { ...enterFinal(next), thesisFeedback }
  if (fullyCorrect) return { ...progressed(next, { step: state.round === 1 ? 'round-1-thesis-result' : 'round-2-thesis-result', independentCycle: state.independentCycle || (state.round === 2 && Boolean(state.workingModel.signals.cinder?.hypothesis) && state.journal.some((entry) => entry.sourceSignal === 'boreal' && entry.receiverSignal === 'cinder')) }), thesisFeedback }
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
