import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'
import { advanceAdditionalTutorial, additionalTutorialView, createAdditionalTutorialState } from '../src/features/tutorial/additional-scenario'

function contractCheckpoint() {
  let state = createAdditionalTutorialState('player-a')
  for (const action of [
    { type: 'start-additional' }, { type: 'choose-contract', contractId: 'lesson-light' },
    { type: 'request-access-slot', slot: 4 },
    { type: 'allocate-power', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 } },
    { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } },
  ] as const) state = advanceAdditionalTutorial(state, action).state
  return { ...state, step: 'contracts' as const }
}

test('additional starts from its explicit standard checkpoint and spends the same four power on a selected resource plan', () => {
  let state = createAdditionalTutorialState('player-a')
  expect(state).toMatchObject({ lessonId: 'additional', scenarioVersion: 'additional-standard-v1', step: 'intro', round: 2, budget: 2, corporateTrust: 1, certifications: ['aster'] })
  expect(state.workingModel.signals.cinder?.hypothesis).toEqual({ fieldType: 'phase', polarity: 'negative' })
  state = advanceAdditionalTutorial(state, { type: 'start-additional' }).state
  state = advanceAdditionalTutorial(state, { type: 'choose-contract', contractId: 'lesson-light' }).state
  state = advanceAdditionalTutorial(state, { type: 'request-access-slot', slot: 4 }).state
  expect(state.budget).toBe(3)
  state = advanceAdditionalTutorial(state, { type: 'allocate-power', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 } }).state
  state = advanceAdditionalTutorial(state, { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } }).state
  expect(state).toMatchObject({ step: 'thesis', budget: 3, corporateTrust: 1 })
  expect(state.journal.at(-1)).toMatchObject({ playerId: 'player-a', protocol: 'continuous', sourceSignal: 'aster', receiverSignal: 'boreal', publicResult: 'reflection' })
  const view = tenderViewSchema.parse(additionalTutorialView(state))
  expect(view.game).toEqual({ mode: 'standard', rounds: 5, powerPerRound: 4, contracts: true, scoring: 'standard' })
  expect(view.privateResearchCertifications).toEqual(['aster'])
  expect(view.players[0].powerAllocation).toEqual({ laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 })
  expect(view.publicContracts.find((contract) => contract.contractId === 'lesson-light')?.planning?.eligible).toBe(true)
})

test('accepted reserve survives a rejected bid and its retry consumes own evidence and awards only once', () => {
  const checkpoint = contractCheckpoint()
  const evidence = checkpoint.journal.at(-1)!.testId
  let state = advanceAdditionalTutorial(checkpoint, { type: 'reserve-contract', contractId: 'lesson-light' }).state
  expect(additionalTutorialView(state).publicContracts[0].reservedByPlayerId).toBe('player-a')
  expect(state.rating).toBe(checkpoint.rating)
  expect(state.usedEvidence).not.toContain(evidence)
  const failed = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: ['prepared-foreign'] })
  expect(failed.error).toBe('evidence-stale')
  state = failed.state
  expect(advanceAdditionalTutorial(state, { type: 'skip-contract' }).error).toBe('contract-reserved')
  expect(advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'lesson-scientific' }).error).toBe('contract-reserved')
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [evidence] }).state
  expect(state).toMatchObject({ rating: checkpoint.rating + 2, corporateTrust: 2, budget: checkpoint.budget })
  expect(state.usedEvidence.filter((id) => id === evidence)).toHaveLength(1)
  expect(additionalTutorialView(state).publicContracts[0].bidOutcome).toBe('awarded')
  expect(advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [evidence] }).state).toEqual(state)
})

test('Scientific consumes its own unused certification once; a pre-reserve skip requires no eligible contract', () => {
  const checkpoint = contractCheckpoint()
  let state = advanceAdditionalTutorial(checkpoint, { type: 'reserve-contract', contractId: 'lesson-scientific' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-scientific', evidenceTestIds: [], researchCertificationSignal: 'aster' }).state
  expect(state.certifications).toEqual([])
  expect(state.certifiedSignals).toContain('aster')
  expect(state.rating).toBe(checkpoint.rating + 3)
  expect(advanceAdditionalTutorial(checkpoint, { type: 'skip-contract' }).error).toBe('eligible-contract')
  const empty = { ...checkpoint, certifications: [], journal: checkpoint.journal.filter((entry) => entry.playerId !== checkpoint.playerId) }
  expect(advanceAdditionalTutorial(empty, { type: 'skip-contract' }).state.step).toBe('contract-result')
})

test('main Cinder earns its first certification; separate mandatory Aster review spends one budget and remaining analysis without awarding again', () => {
  let state = { ...contractCheckpoint(), step: 'thesis' as const }
  const main = advanceAdditionalTutorial(state, { type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' }).state
  expect(main).toMatchObject({ step: 'review-intro', rating: 2, certifications: ['aster', 'cinder'] })
  state = advanceAdditionalTutorial(main, { type: 'begin-review' }).state
  expect(state).toMatchObject({ step: 'review-power', budget: 1, rating: 1, certifications: ['aster'] })
  state = advanceAdditionalTutorial(state, { type: 'allocate-power', allocation: { laboratory: 1, modelAnalysis: 2, contracts: 1, reconnaissance: 0 } }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-thesis', signalId: 'aster', fieldType: 'phase', polarity: 'positive' }).state
  expect(state).toMatchObject({ step: 'review-thesis', budget: 1, corporateReviewActive: true, rating: 1 })
  expect(state.privateTheses.at(-1)).toMatchObject({ fieldTypeCorrect: false, polarityCorrect: true })
  const wrong = state
  state = advanceAdditionalTutorial(state, { type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }).state
  expect(state).toMatchObject({ step: 'review-result', budget: 0, rating: 1, certifications: ['aster'] })
  expect(state.privateTheses).toHaveLength(2)
  expect(advanceAdditionalTutorial(state, { type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }).state).toEqual(state)
  const reset = advanceAdditionalTutorial(wrong, { type: 'restart-checkpoint' }).state
  expect(reset).toMatchObject({ step: 'review-thesis', budget: 1, privateTheses: [], corporateReviewActive: false })
  state = advanceAdditionalTutorial(state, { type: 'continue-additional' }).state
  expect(state).toMatchObject({ step: 'contracts', budget: main.budget, rating: main.rating, certifications: ['aster', 'cinder'], reviewCompleted: true })
  expect(state.journal).toEqual(main.journal)
})

test('the labelled partial-delivery scene retries only its reservation and returns to the main awards unchanged', () => {
  const prepared = { ...contractCheckpoint(), reviewCompleted: true }
  let state = advanceAdditionalTutorial(prepared, { type: 'reserve-contract', contractId: 'lesson-light' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [prepared.journal.at(-1)!.testId] }).state
  const main = state
  state = advanceAdditionalTutorial(state, { type: 'begin-recovery' }).state
  expect(state).toMatchObject({ step: 'recovery-contracts', checkpointKind: 'recovery' })
  const evidence = state.journal.at(-1)!.testId
  state = advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'lesson-light' }).state
  const interrupted = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [evidence] })
  expect(interrupted.error).toBe('training-interruption')
  expect(interrupted.state.usedEvidence).not.toContain(evidence)
  expect(advanceAdditionalTutorial(interrupted.state, { type: 'skip-contract' }).error).toBe('contract-reserved')
  state = advanceAdditionalTutorial(interrupted.state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [evidence] }).state
  expect(state).toMatchObject({ step: 'recovery-result', rating: 3 })
  state = advanceAdditionalTutorial(state, { type: 'continue-additional' }).state
  expect(state).toMatchObject({ step: 'final-intro', rating: main.rating, corporateTrust: main.corporateTrust, recoveryCompleted: true })
  expect(state.journal).toEqual(main.journal)
  expect(state.usedEvidence).toEqual(main.usedEvidence)
})

test('late Final keeps previously used evidence, requires its own accepted bid and a separate editable nonempty standard model submission', () => {
  let state = { ...contractCheckpoint(), step: 'final-intro' as const, reviewCompleted: true, recoveryCompleted: true, ordinaryAccepted: true }
  state = advanceAdditionalTutorial(state, { type: 'prepare-final' }).state
  const view = additionalTutorialView(state)
  expect(state).toMatchObject({ step: 'final-contract', round: 5, corporateTrust: 2 })
  expect(state.usedEvidence).toContain('prepared-used')
  expect(view.publicFinalContract?.planning?.eligible).toBe(true)
  const evidence = view.publicFinalContract!.planning!.suitableEvidenceSelections[0]
  const beforeRating = state.rating
  state = advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'final-contract' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'final-contract', evidenceTestIds: evidence }).state
  expect(state.rating).toBe(beforeRating + 8)
  state = advanceAdditionalTutorial(state, { type: 'continue-additional' }).state
  expect(state.step).toBe('final-model')
  const submitted = { signals: { aster: { fieldType: 'inertial', polarity: 'positive' }, cinder: { fieldType: 'phase' } } } as const
  state = advanceAdditionalTutorial(state, { type: 'update-scientific-model-draft', scientificModelDraft: { signals: {} } }).state
  expect(state.finalSubmission).toBeNull()
  expect(advanceAdditionalTutorial(state, { type: 'submit-scientific-model', scientificModel: { signals: {} } }).state.step).toBe('final-model')
  state = advanceAdditionalTutorial(state, { type: 'submit-scientific-model', scientificModel: submitted }).state
  expect(state).toMatchObject({ step: 'complete', finalSubmission: submitted, modelScore: 4, rating: beforeRating + 8 + 4 })
})

test('a complete additional course preserves its earned main result across review/recovery and clears prior-round reservations before Final', () => {
  let state = createAdditionalTutorialState('player-a')
  for (const action of [
    { type: 'start-additional' }, { type: 'choose-contract', contractId: 'lesson-light' }, { type: 'request-access-slot', slot: 4 },
    { type: 'allocate-power', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 } },
    { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } },
    { type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' }, { type: 'begin-review' },
    { type: 'allocate-power', allocation: { laboratory: 1, modelAnalysis: 2, contracts: 1, reconnaissance: 0 } },
    { type: 'submit-thesis', signalId: 'aster', fieldType: 'phase', polarity: 'positive' },
    { type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }, { type: 'continue-additional' },
  ] as const) state = advanceAdditionalTutorial(state, action).state
  const own = state.journal.at(-1)!.testId
  state = advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'lesson-light' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [own] }).state
  state = advanceAdditionalTutorial(state, { type: 'begin-recovery' }).state
  const recovery = state.journal.at(-1)!.testId
  state = advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'lesson-light' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [recovery] }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [recovery] }).state
  state = advanceAdditionalTutorial(state, { type: 'continue-additional' }).state
  state = advanceAdditionalTutorial(state, { type: 'prepare-final' }).state
  expect(advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'final-contract' }).error).toBeUndefined()
  state = advanceAdditionalTutorial(state, { type: 'reserve-contract', contractId: 'final-contract' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-contract-bid', contractId: 'final-contract', evidenceTestIds: ['prepared-late-final'] }).state
  state = advanceAdditionalTutorial(state, { type: 'continue-additional' }).state
  state = advanceAdditionalTutorial(state, { type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'inertial', polarity: 'positive' } } } }).state
  expect(state).toMatchObject({ step: 'complete', reviewCompleted: true, recoveryCompleted: true, ordinaryAccepted: true, rating: 15, modelScore: 3 })
  expect(state.usedEvidence).toContain(own)
  expect(state.journal.some((entry) => entry.testId === recovery)).toBe(false)
})


test('a different prepared slot or allocation gives explicit recoverable instruction without spending resources', () => {
  let state = advanceAdditionalTutorial(createAdditionalTutorialState('player-a'), { type: 'start-additional' }).state
  state = advanceAdditionalTutorial(state, { type: 'choose-contract', contractId: 'lesson-light' }).state
  const wrongSlot = advanceAdditionalTutorial(state, { type: 'request-access-slot', slot: 3 })
  expect(wrongSlot).toEqual({ state, error: 'prepared-slot-required' })
  state = advanceAdditionalTutorial(state, { type: 'request-access-slot', slot: 4 }).state
  const wrongAllocation = advanceAdditionalTutorial(state, { type: 'allocate-power', allocation: { laboratory: 1, modelAnalysis: 2, contracts: 1, reconnaissance: 0 } })
  expect(wrongAllocation).toEqual({ state, error: 'prepared-allocation-required' })
  expect(state.budget).toBe(3)
})
