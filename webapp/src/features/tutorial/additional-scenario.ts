import { gameDescriptor, powerAllocationSchema, scientificModelDraftSchema, scientificModelSchema } from '@anomaly-detector/contracts'
import type { FieldType, Polarity, PowerAllocation, PrivateThesis, PublicContract, ScientificJournalEntry, ScientificModel, ScientificModelDraft, SignalId, TenderPhase, TenderView, WorkingModel } from '@anomaly-detector/contracts'
import type { TenderCommandInput } from '@/features/tender/public/tutorial-board'
import { translate } from '@/platform/i18n'

export const additionalScenarioVersion = 'additional-standard-v1' as const
export type AdditionalStep = 'intro' | 'plan' | 'access' | 'power' | 'laboratory' | 'thesis' | 'review-intro' | 'review-power' | 'review-thesis' | 'review-result' | 'contracts' | 'contract-result' | 'recovery-contracts' | 'recovery-result' | 'final-intro' | 'final-contract' | 'final-contract-result' | 'final-model' | 'complete'
export type AdditionalTutorialState = {
  lessonId: 'additional'
  scenarioVersion: typeof additionalScenarioVersion
  playerId: string
  step: AdditionalStep
  round: number
  budget: number
  corporateTrust: number
  rating: number
  accessSlot: number | null
  allocation: PowerAllocation | null
  selectedContractId: string | null
  samples: SignalId[]
  journal: ScientificJournalEntry[]
  usedEvidence: string[]
  certifications: SignalId[]
  certifiedSignals: SignalId[]
  privateTheses: PrivateThesis[]
  privateMeasurements: TenderView['privateMeasurements']
  corporateReviewActive: boolean
  workingModel: WorkingModel
  finalDraft: ScientificModelDraft | null
  finalSubmission: ScientificModel | null
  publicContracts: PublicContract[]
  publicFinalContract: PublicContract
  checkpointKind: 'main' | 'review' | 'recovery' | 'late-final'
  checkpointStep: AdditionalStep | null
  checkpointInitial: AdditionalCheckpoint | null
  mainCheckpoint: AdditionalCheckpoint | null
  reviewCompleted: boolean
  recoveryCompleted: boolean
  ordinaryAccepted: boolean
  recoveryInterruptionPending: boolean
  modelScore: number
}
const checkpointFields = ['round', 'budget', 'corporateTrust', 'rating', 'accessSlot', 'allocation', 'selectedContractId', 'samples', 'journal', 'usedEvidence', 'certifications', 'certifiedSignals', 'privateTheses', 'privateMeasurements', 'corporateReviewActive', 'workingModel', 'finalDraft', 'finalSubmission', 'publicContracts', 'publicFinalContract'] as const
type AdditionalCheckpoint = Pick<AdditionalTutorialState, typeof checkpointFields[number]>
export type AdditionalAction = TenderCommandInput
  | { type: 'start-additional' }
  | { type: 'choose-contract'; contractId: string }
  | { type: 'begin-review' }
  | { type: 'restart-checkpoint' }
  | { type: 'continue-additional' }
  | { type: 'begin-recovery' }
  | { type: 'prepare-final' }
export type AdditionalError = 'prepared-slot-required' | 'prepared-allocation-required' | 'contract-unavailable' | 'contract-reserved' | 'evidence-stale' | 'eligible-contract' | 'analysis-exhausted' | 'budget-required' | 'prepared-thesis-required' | 'controlled-wrong-required' | 'training-interruption' | 'lesson-incomplete' | 'empty-final-model'
export type AdditionalAdvanceResult = { state: AdditionalTutorialState; error?: AdditionalError }

const signals: SignalId[] = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro']
const properties: Record<SignalId, { fieldType: FieldType; polarity: Polarity }> = {
  aster: { fieldType: 'inertial', polarity: 'positive' }, boreal: { fieldType: 'electromagnetic', polarity: 'positive' },
  cinder: { fieldType: 'phase', polarity: 'negative' }, delta: { fieldType: 'inertial', polarity: 'negative' },
  eclipse: { fieldType: 'electromagnetic', polarity: 'negative' }, ferro: { fieldType: 'phase', polarity: 'positive' },
}
const contracts: PublicContract[] = [
  { contractId: 'lesson-light', kind: 'light', targetSignal: 'aster', targetRole: 'source', requiredPublicResult: 'reflection', ratingReward: 2 },
  { contractId: 'lesson-scientific', kind: 'scientific', targetSignal: 'aster', targetRole: 'source', requiredPublicResult: 'reflection', ratingReward: 3 },
  { contractId: 'lesson-complex', kind: 'complex', targetSignal: 'aster', targetRole: 'source', requiredPublicResult: 'reflection', requiredSecondaryPublicResult: 'unstable_collapse', ratingReward: 4 },
]
const finalContract: PublicContract = { ...contracts[2], contractId: 'final-contract', kind: 'final', targetSignal: 'boreal', ratingReward: 8 }

export function createAdditionalTutorialState(playerId: string): AdditionalTutorialState {
  return {
    lessonId: 'additional', scenarioVersion: additionalScenarioVersion, playerId, step: 'intro', round: 2,
    budget: 2, corporateTrust: 1, rating: 1, accessSlot: null, allocation: null, selectedContractId: null,
    samples: ['aster', 'boreal', 'cinder', 'eclipse'],
    journal: [
      { testId: 'prepared-foreign', playerId: 'tutorial-opponent', sourceSignal: 'aster', receiverSignal: 'boreal', protocol: 'impulse', publicResult: 'reflection' },
      { testId: 'prepared-used', playerId, sourceSignal: 'boreal', receiverSignal: 'cinder', protocol: 'impulse', publicResult: 'unstable_collapse' },
      { testId: 'prepared-other-role', playerId, sourceSignal: 'cinder', receiverSignal: 'aster', protocol: 'impulse', publicResult: 'unstable_collapse' },
    ],
    usedEvidence: ['prepared-used'], certifications: ['aster'], certifiedSignals: ['aster'], privateTheses: [], privateMeasurements: [], corporateReviewActive: false,
    workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } }, boreal: { hypothesis: { fieldType: 'electromagnetic', polarity: 'positive' } }, cinder: { hypothesis: { fieldType: 'phase', polarity: 'negative' } } } },
    finalDraft: null, finalSubmission: null,
    publicContracts: contracts.map((contract) => ({ ...contract })), publicFinalContract: { ...finalContract },
    checkpointKind: 'main', checkpointStep: null, checkpointInitial: null, mainCheckpoint: null, reviewCompleted: false, recoveryCompleted: false, ordinaryAccepted: false, recoveryInterruptionPending: false, modelScore: 0,
  }
}

function planning(state: AdditionalTutorialState, contract: PublicContract): NonNullable<PublicContract['planning']> {
  const own = state.journal.filter((entry) => entry.playerId === state.playerId && !state.usedEvidence.includes(entry.testId))
  const matching = own.filter((entry) => entry[contract.targetRole === 'receiver' ? 'receiverSignal' : 'sourceSignal'] === contract.targetSignal)
  const primary = matching.filter((entry) => entry.publicResult === contract.requiredPublicResult)
  const secondaryResult = contract.requiredSecondaryPublicResult ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
  const secondary = matching.filter((entry) => entry.publicResult === secondaryResult)
  const selections = contract.kind === 'scientific' ? [] : contract.kind === 'light' ? primary.map((entry) => [entry.testId])
    : [...primary, ...secondary].filter((entry) => entry.protocol === 'continuous').map((entry) => [entry.testId])
      .concat(primary.filter((entry) => entry.protocol === 'impulse').flatMap((first) => secondary.filter((entry) => entry.protocol === 'impulse').map((second) => [first.testId, second.testId])))
  const certifications = contract.kind === 'scientific' && contract.targetSignal && state.certifications.includes(contract.targetSignal) ? [contract.targetSignal] : []
  const missing: NonNullable<PublicContract['planning']>['missingConditions'] = []
  if (contract.bidOutcome !== undefined) missing.push('already_resolved')
  if (contract.reservedByPlayerId && contract.reservedByPlayerId !== state.playerId) missing.push('reserved')
  if (contract.kind === 'final' && state.round !== 5) missing.push('final_round')
  if (contract.kind === 'final' && state.corporateTrust < 2) missing.push('corporate_trust')
  if (contract.kind === 'scientific' ? certifications.length === 0 : selections.length === 0) {
    const accepted = [contract.requiredPublicResult, secondaryResult]
    const role = contract.targetRole === 'receiver' ? 'receiverSignal' : 'sourceSignal'
    const opposite = role === 'sourceSignal' ? 'receiverSignal' : 'sourceSignal'
    const used = state.journal.some((entry) => entry.playerId === state.playerId && state.usedEvidence.includes(entry.testId) && entry[role] === contract.targetSignal && accepted.includes(entry.publicResult))
    const wrongRole = own.some((entry) => entry[opposite] === contract.targetSignal && accepted.includes(entry.publicResult))
    missing.push(contract.kind === 'scientific' ? 'evidence' : used ? 'evidence_used' : wrongRole ? 'evidence_role' : matching.length ? 'evidence_result' : 'evidence')
  }
  return { eligible: missing.length === 0, missingConditions: missing, requiredPower: 1, suitableEvidenceSelections: selections, suitableEvidenceTestIds: [...new Set(selections.flat())], suitableResearchCertificationSignals: certifications }
}

function result(source: SignalId, receiver: SignalId) {
  const a = properties[source], b = properties[receiver], same = a.polarity === b.polarity
  if (a.fieldType === b.fieldType) return same ? 'transmission_gain' as const : 'attenuation' as const
  const types: FieldType[] = ['inertial', 'electromagnetic', 'phase']
  return (types.indexOf(a.fieldType) + 1) % 3 === types.indexOf(b.fieldType)
    ? same ? 'reflection' as const : 'unstable_collapse' as const
    : same ? 'attenuation' as const : 'transmission_gain' as const
}

export function advanceAdditionalTutorial(state: AdditionalTutorialState, action: AdditionalAction): AdditionalAdvanceResult {
  if (action.type === 'restart-checkpoint' && state.checkpointInitial && state.checkpointStep) return { state: { ...state, ...state.checkpointInitial, step: state.checkpointStep, recoveryInterruptionPending: state.checkpointKind === 'recovery' } }
  if (action.type === 'submit-thesis' && (state.step === 'thesis' || state.step === 'review-thesis')) return submitThesis(state, action)
  if (action.type === 'begin-review' && state.step === 'review-intro') {
    const prepared = createAdditionalTutorialState(state.playerId)
    return { state: { ...prepared, step: 'review-power', budget: 1, checkpointKind: 'review', mainCheckpoint: snapshot(state) } }
  }
  if (action.type === 'continue-additional' && state.step === 'review-result' && state.privateTheses.at(-1)?.fullyCorrect && state.mainCheckpoint) {
    const next: AdditionalTutorialState = { ...state, ...state.mainCheckpoint, step: 'contracts', checkpointKind: 'main', checkpointStep: 'contracts', mainCheckpoint: null, reviewCompleted: true }
    return { state: { ...next, checkpointInitial: snapshot(next) } }
  }
  if (action.type === 'begin-recovery' && state.step === 'contract-result' && state.ordinaryAccepted && state.reviewCompleted) {
    const prepared = createAdditionalTutorialState(state.playerId)
    const next: AdditionalTutorialState = { ...prepared, step: 'recovery-contracts', checkpointKind: 'recovery', checkpointStep: 'recovery-contracts', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 }, certifications: [], reviewCompleted: true, mainCheckpoint: snapshot(state), recoveryInterruptionPending: true,
      journal: [...prepared.journal, { testId: 'recovery-own', playerId: state.playerId, sourceSignal: 'aster', receiverSignal: 'boreal', protocol: 'continuous', publicResult: 'reflection' }],
    }
    return { state: { ...next, checkpointInitial: snapshot(next) } }
  }
  if (action.type === 'continue-additional' && state.step === 'recovery-result' && state.mainCheckpoint) return { state: { ...state, ...state.mainCheckpoint, step: 'final-intro', checkpointKind: 'main', checkpointStep: null, checkpointInitial: null, mainCheckpoint: null, recoveryCompleted: true, ordinaryAccepted: true, recoveryInterruptionPending: false } }
  if (action.type === 'prepare-final' && state.step === 'final-intro' && state.recoveryCompleted) {
    const next: AdditionalTutorialState = { ...state, round: 5, corporateTrust: 2, step: 'final-contract', checkpointKind: 'late-final', checkpointStep: 'final-contract', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 }, publicContracts: [], publicFinalContract: { ...finalContract }, samples: [...new Set([...state.samples, 'ferro' as const])],
      journal: [...state.journal, { testId: 'prepared-late-final', playerId: state.playerId, sourceSignal: 'boreal', receiverSignal: 'ferro', protocol: 'continuous', publicResult: 'reflection' }],
    }
    return { state: { ...next, checkpointInitial: snapshot(next) } }
  }
  if (action.type === 'continue-additional' && state.step === 'final-contract-result') {
    const signals = Object.fromEntries(Object.entries(state.workingModel.signals).flatMap(([id, model]) => model.hypothesis && (model.hypothesis.fieldType || model.hypothesis.polarity) ? [[id, { ...model.hypothesis }]] : []))
    return { state: { ...state, step: 'final-model', finalDraft: { signals } } }
  }
  if (action.type === 'update-working-model' && state.step !== 'complete') return { state: { ...state, workingModel: action.workingModel } }
  if (action.type === 'update-scientific-model-draft' && state.step === 'final-model') {
    const draft = scientificModelDraftSchema.safeParse(action.scientificModelDraft)
    if (draft.success) return { state: { ...state, finalDraft: draft.data } }
  }
  if (action.type === 'submit-scientific-model' && state.step === 'final-model') return submitFinalModel(state, action.scientificModel)
  if (['contracts', 'recovery-contracts', 'final-contract'].includes(state.step) && ['reserve-contract', 'submit-contract-bid', 'skip-contract'].includes(action.type)) return contractAction(state, action)
  if (action.type === 'start-additional' && state.step === 'intro') return { state: { ...state, step: 'plan' } }
  if (action.type === 'choose-contract' && state.step === 'plan' && ['lesson-light', 'lesson-scientific'].includes(action.contractId)) return { state: { ...state, selectedContractId: action.contractId, step: 'access' } }
  if (action.type === 'request-access-slot' && state.step === 'access' && action.slot === 4) return { state: { ...state, step: 'power', accessSlot: 4, budget: state.budget + 1 } }
  if (action.type === 'request-access-slot' && state.step === 'access') return { state, error: 'prepared-slot-required' }
  if (action.type === 'allocate-power' && (state.step === 'power' || state.step === 'review-power')) {
    const allocation = powerAllocationSchema.safeParse(action.allocation)
    if (allocation.success && allocation.data.contracts === 1 && allocation.data.reconnaissance === 0) {
      if (state.step === 'power' && allocation.data.laboratory === 2 && allocation.data.modelAnalysis === 1) return { state: { ...state, allocation: allocation.data, step: 'laboratory' } }
      if (state.step === 'review-power' && allocation.data.laboratory === 1 && allocation.data.modelAnalysis === 2) {
        const next: AdditionalTutorialState = { ...state, allocation: allocation.data, step: 'review-thesis' }
        return { state: { ...next, checkpointStep: 'review-thesis', checkpointInitial: snapshot(next) } }
      }
    }
    return { state, error: 'prepared-allocation-required' }
  }
  if (action.type === 'run-laboratory-test' && state.step === 'laboratory' && 'laboratory' in action && action.laboratory) {
    const lab = action.laboratory
    const pairs = lab.mode === 'deep' ? [lab.pair] : lab.mode === 'broad' ? lab.pairs : []
    if (!pairs.length || pairs.some((pair) => pair.sourceSignal === pair.receiverSignal || !state.samples.includes(pair.sourceSignal) || !state.samples.includes(pair.receiverSignal) || state.journal.some((entry) => entry.playerId === state.playerId && entry.sourceSignal === pair.sourceSignal && entry.receiverSignal === pair.receiverSignal)) || new Set(pairs.map((pair) => `${pair.sourceSignal}:${pair.receiverSignal}`)).size !== pairs.length) return { state }
    const journal: ScientificJournalEntry[] = pairs.map((pair, index) => ({ ...pair, testId: `additional-own-${state.journal.length + index + 1}`, playerId: state.playerId, protocol: lab.mode === 'deep' ? 'continuous' : 'impulse', publicResult: result(pair.sourceSignal, pair.receiverSignal) }))
    const privateMeasurements = lab.mode === 'deep' ? [...state.privateMeasurements, { ...pairs[0], polarityRelation: properties[pairs[0].sourceSignal].polarity === properties[pairs[0].receiverSignal].polarity ? 'same' as const : 'different' as const }] : state.privateMeasurements
    const next: AdditionalTutorialState = { ...state, step: 'thesis', journal: [...state.journal, ...journal], privateMeasurements }
    return { state: { ...next, checkpointStep: 'thesis', checkpointInitial: snapshot(next) } }
  }
  return { state }
}

function submitFinalModel(state: AdditionalTutorialState, input: ScientificModel): AdditionalAdvanceResult {
  if (!state.reviewCompleted || !state.recoveryCompleted || !state.ordinaryAccepted || state.publicFinalContract.bidOutcome !== 'awarded') return { state, error: 'lesson-incomplete' }
  const model = scientificModelSchema.safeParse(input)
  if (!model.success) return { state, error: 'empty-final-model' }
  let correctProperties = 0, correctSignals = 0
  for (const signal of signals) {
    const claim = model.data.signals[signal], actual = properties[signal]
    correctProperties += Number(claim?.fieldType === actual.fieldType) + Number(claim?.polarity === actual.polarity)
    correctSignals += Number(claim?.fieldType === actual.fieldType && claim?.polarity === actual.polarity)
  }
  const modelScore = correctProperties + correctSignals + (correctSignals === signals.length ? 3 : 0)
  return { state: { ...state, step: 'complete', finalSubmission: model.data, modelScore, rating: state.rating + modelScore } }
}

function snapshot(state: AdditionalTutorialState): AdditionalCheckpoint {
  return Object.fromEntries(checkpointFields.map((field) => [field, state[field]])) as AdditionalCheckpoint
}

function submitThesis(state: AdditionalTutorialState, action: Extract<AdditionalAction, { type: 'submit-thesis' }>): AdditionalAdvanceResult {
  const review = state.checkpointKind === 'review'
  if (action.signalId !== (review ? 'aster' : 'cinder')) return { state, error: 'prepared-thesis-required' }
  const attempts = state.privateTheses.filter((thesis) => thesis.round === state.round).length
  if (attempts >= (state.allocation?.modelAnalysis ?? 0)) return { state, error: 'analysis-exhausted' }
  if (state.corporateReviewActive && state.budget < 1) return { state, error: 'budget-required' }
  if (review && attempts === 0 && !(action.fieldType === 'phase' && action.polarity === 'positive')) return { state, error: 'controlled-wrong-required' }
  const actual = properties[action.signalId]
  const fieldTypeCorrect = action.fieldType === actual.fieldType, polarityCorrect = action.polarity === actual.polarity
  const fullyCorrect = fieldTypeCorrect && polarityCorrect
  const earnsCertification = fullyCorrect && !state.certifiedSignals.includes(action.signalId)
  const thesis: PrivateThesis = { id: `${state.checkpointKind}-thesis-${attempts + 1}`, round: state.round, signalId: action.signalId, fieldType: action.fieldType, polarity: action.polarity, fieldTypeCorrect, polarityCorrect, fullyCorrect }
  return { state: {
    ...state, step: review ? attempts === 1 ? 'review-result' : 'review-thesis' : fullyCorrect ? 'review-intro' : 'thesis',
    budget: state.budget - Number(state.corporateReviewActive), corporateReviewActive: state.corporateReviewActive || !fullyCorrect,
    privateTheses: [...state.privateTheses, thesis], rating: state.rating + Number(earnsCertification),
    certifications: earnsCertification ? [...state.certifications, action.signalId] : state.certifications,
    certifiedSignals: earnsCertification ? [...state.certifiedSignals, action.signalId] : state.certifiedSignals,
  } }
}

function contractAction(state: AdditionalTutorialState, action: AdditionalAction): AdditionalAdvanceResult {
  const all = [...state.publicContracts, state.publicFinalContract]
  const reserved = all.find((contract) => contract.reservedByPlayerId === state.playerId)
  if (action.type === 'skip-contract') {
    if (reserved) return { state, error: 'contract-reserved' }
    if (all.some((contract) => planning(state, contract).eligible)) return { state, error: 'eligible-contract' }
    return { state: { ...state, step: state.checkpointKind === 'recovery' ? 'recovery-result' : 'contract-result' } }
  }
  if (action.type !== 'reserve-contract' && action.type !== 'submit-contract-bid') return { state }
  const contract = all.find((candidate) => candidate.contractId === action.contractId)
  if (!contract || state.allocation?.contracts !== 1) return { state, error: 'contract-unavailable' }
  const patch = (next: PublicContract) => ({
    publicContracts: state.publicContracts.map((candidate) => candidate.contractId === next.contractId ? next : candidate),
    publicFinalContract: next.kind === 'final' ? next : state.publicFinalContract,
  })
  if (action.type === 'reserve-contract') {
    if (reserved) return { state, error: 'contract-reserved' }
    if (contract.reservedByPlayerId || !planning(state, contract).eligible) return { state, error: 'contract-unavailable' }
    return { state: { ...state, ...patch({ ...contract, reservedByPlayerId: state.playerId }) } }
  }
  if (contract.reservedByPlayerId !== state.playerId || contract.bidOutcome !== undefined) return { state, error: 'contract-unavailable' }
  const available = planning(state, contract)
  const ids = action.evidenceTestIds ?? []
  const eligible = available.eligible && ids.length === new Set(ids).size && (contract.kind === 'scientific'
    ? ids.length === 0 && action.researchCertificationSignal !== undefined && available.suitableResearchCertificationSignals.includes(action.researchCertificationSignal)
    : available.suitableEvidenceSelections.some((selection) => selection.length === ids.length && selection.every((id) => ids.includes(id))))
  if (!eligible) return { state, error: 'evidence-stale' }
  if (state.checkpointKind === 'recovery' && state.recoveryInterruptionPending) return { state: { ...state, recoveryInterruptionPending: false }, error: 'training-interruption' }
  return { state: {
    ...state, ...patch({ ...contract, bidOutcome: 'awarded', awardedToPlayerId: state.playerId }), step: contract.kind === 'final' ? 'final-contract-result' : state.checkpointKind === 'recovery' ? 'recovery-result' : 'contract-result', ordinaryAccepted: state.ordinaryAccepted || state.checkpointKind === 'main',
    rating: state.rating + (contract.ratingReward ?? 0), corporateTrust: state.corporateTrust + Number(contract.kind !== 'final'),
    certifications: contract.kind === 'scientific' ? state.certifications.filter((signal) => signal !== action.researchCertificationSignal) : state.certifications,
    usedEvidence: contract.kind === 'scientific' ? state.usedEvidence : [...state.usedEvidence, ...ids],
  } }
}

export function additionalTutorialView(state: AdditionalTutorialState): TenderView {
  const phase: TenderPhase = state.step === 'complete' ? 'complete' : state.step === 'final-model' ? 'final-scientific-model' : state.step === 'access' || state.step === 'intro' || state.step === 'plan' ? 'access-slot-selection' : state.step === 'power' || state.step === 'review-power' ? 'power-allocation' : state.step === 'laboratory' ? 'laboratory' : state.step.includes('contract') ? 'contracts' : 'model-analysis'
  return {
    game: gameDescriptor('standard'), phase, round: state.round, ruleset: 'tender-v2', dueAt: null, serverTime: '2026-11-03T00:00:00.000Z', tenderId: 'tutorial-additional', version: state.journal.length + state.privateTheses.length,
    activePlayerId: ['laboratory', 'contracts'].includes(phase) ? state.playerId : undefined,
    knownSignals: signals, availableSamplePool: [], privateSamples: state.samples, privateRawTelemetrySignals: [], privateMeasurements: state.privateMeasurements, privateTheses: state.privateTheses, privateWorkingModel: state.workingModel,
    privateResearchCertifications: state.certifications, privateUsedContractEvidenceTestIds: state.usedEvidence, corporateReviewActive: state.corporateReviewActive,
    ...(state.finalDraft ? { privateFinalScientificModelDraft: state.finalDraft } : {}),
    ...(state.finalSubmission ? { privateFinalScientificModelSubmission: { scientificModel: state.finalSubmission, submittedAt: '2026-11-03T00:00:00.000Z' } } : {}),
    publicContracts: state.publicContracts.map((contract) => ({ ...contract, planning: planning(state, contract) })), publicFinalContract: { ...state.publicFinalContract, planning: planning(state, state.publicFinalContract) },
    publicLaboratoryResults: state.journal.map((entry) => ({ playerId: entry.playerId, sourceSignal: entry.sourceSignal, receiverSignal: entry.receiverSignal, protocol: entry.protocol, publicResult: entry.publicResult })), publicScientificJournal: state.journal, publicTheses: [],
    players: [{ playerId: state.playerId, displayName: translate('tutorial.player.you'), tiePriority: 1, budget: state.budget, rating: state.rating, corporateTrust: state.corporateTrust, contractPowerRestriction: 0,
      ...(state.accessSlot !== null ? { accessSlot: state.accessSlot, requestedAccessSlot: state.accessSlot } : {}), ...(state.allocation ? { powerAllocation: state.allocation, powerAllocationConfirmed: true } : {}),
      ...(phase === 'model-analysis' ? { modelAnalysisCompleted: state.privateTheses.filter((thesis) => thesis.round === state.round).length >= (state.allocation?.modelAnalysis ?? 0) || (state.corporateReviewActive && state.budget < 1) } : {}),
    }, { playerId: 'tutorial-opponent', displayName: translate('tutorial.player.opponent'), tiePriority: 2, budget: 2, rating: 0, corporateTrust: 0, contractPowerRestriction: 0 }],
  }
}
