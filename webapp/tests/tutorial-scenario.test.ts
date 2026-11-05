import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'
import { advanceTutorial, createTutorialState, tutorialView, type TutorialAction, type TutorialState } from '../src/features/tutorial/scenario'

function run(state: TutorialState, actions: TutorialAction[]) {
  for (const action of actions) state = advanceTutorial(state, action).state
  return state
}
function firstResearch() {
  return run(createTutorialState('player-a'), [
    { type: 'start-tutorial' }, { type: 'request-access-slot', slot: 6 },
    { type: 'allocate-power', allocation: { reconnaissance: 1, laboratory: 2, modelAnalysis: 1, contracts: 0 } },
    { type: 'conduct-reconnaissance', targets: ['aster'] }, { type: 'select-laboratory-mode', mode: 'deep' },
    { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } },
  ])
}
function firstThesis() {
  return run(firstResearch(), [
    { type: 'open-research-results' }, { type: 'open-interpretation' }, { type: 'open-working-model' },
    { type: 'update-working-model', workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } } } } },
    { type: 'close-research-results' },
  ])
}
function independentThesis() {
  return run(firstThesis(), [
    { type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }, { type: 'continue' },
    { type: 'request-access-slot', slot: 5 },
    { type: 'allocate-power', allocation: { reconnaissance: 0, laboratory: 1, modelAnalysis: 2, contracts: 0, reserve: 1 } },
    { type: 'run-laboratory-test', laboratory: { mode: 'impulse', pair: { sourceSignal: 'boreal', receiverSignal: 'cinder' } } },
    { type: 'open-research-results' }, { type: 'open-working-model' },
    { type: 'update-working-model', workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } }, cinder: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } } } } },
    { type: 'close-research-results' },
  ])
}

test('base orientation is attached to actual actions with no Next-only introductions', () => {
  const start = advanceTutorial(createTutorialState('player-a'), { type: 'start-tutorial' }).state
  expect(start.step).toBe('round-1-access')
  expect(advanceTutorial(start, { type: 'request-access-slot', slot: 5 }).progressed).toBe(false)
  const access = advanceTutorial(start, { type: 'request-access-slot', slot: 6 }).state
  expect(access.step).toBe('round-1-power')
  expect(access.budget).toBe(3)
  expect(access.samples).toEqual(['boreal'])
})

test('base participant projection is simple 3×4 with private data, no Contracts, timer or hidden configuration', () => {
  const initial = tutorialView(createTutorialState('player-a'))
  expect(tenderViewSchema.parse(initial)).toEqual(initial)
  expect(initial.game).toEqual({ mode: 'simple', rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' })
  expect(initial.dueAt).toBeNull()
  expect(initial.knownSignals).toEqual(['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'])
  expect(initial.publicContracts).toEqual([])
  expect(initial.publicScientificJournal).toEqual([])
  expect(initial.players.every((player) => player.requestedAccessSlot === undefined)).toBe(true)
  expect('anomalyConfiguration' in initial).toBe(false)
  const researched = tutorialView(firstResearch())
  expect(tenderViewSchema.parse(researched)).toEqual(researched)
  expect(researched.publicScientificJournal).toMatchObject([{ playerId: 'player-a', protocol: 'continuous', sourceSignal: 'aster', receiverSignal: 'boreal', publicResult: 'reflection' }])
  expect(researched.privateMeasurements).toEqual([{ sourceSignal: 'aster', receiverSignal: 'boreal', polarityRelation: 'same' }])
})

test('a wrong complete hypothesis is saved neutrally and closes to the explicit Thesis action', () => {
  const state = run(firstResearch(), [{ type: 'open-research-results' }, { type: 'open-interpretation' }, { type: 'open-working-model' }])
  const workingModel = { signals: { aster: { hypothesis: { fieldType: 'phase' as const, polarity: 'negative' as const } } } }
  const saved = advanceTutorial(state, { type: 'update-working-model', workingModel })
  expect(saved.state.workingModel).toEqual(workingModel)
  expect(saved.state.step).toBe('round-1-working-model')
  expect(saved.state.privateTheses).toEqual([])
  expect(saved.thesisFeedback).toBeUndefined()
  const closed = advanceTutorial(saved.state, { type: 'close-journal', workingModel })
  expect(closed.state.step).toBe('round-1-thesis')
  expect(closed.state.privateTheses).toEqual([])
})

test('reading results enters Analysis; closing or reloading a Journal never submits a Thesis', () => {
  const researched = firstResearch()
  expect(researched.step).toBe('research-results')
  expect(tutorialView(researched).phase).toBe('model-analysis')
  const opened = advanceTutorial(researched, { type: 'open-research-results' }).state
  const closed = advanceTutorial(opened, { type: 'close-journal', workingModel: opened.workingModel }).state
  expect(closed.step).toBe('research-results')
  expect(closed.journal).toHaveLength(1)
  expect(closed.privateTheses).toEqual([])
})

test('wrong Thesis checks field and polarity separately, consumes the allocated attempt and needs an explicit checkpoint reset', () => {
  const state = firstThesis()
  const wrong = { type: 'submit-thesis', signalId: 'aster', fieldType: 'phase', polarity: 'positive' } as const
  const first = advanceTutorial(state, wrong)
  expect(first.thesisFeedback).toEqual({ fieldTypeCorrect: false, polarityCorrect: true })
  expect(first.state.thesisAttempts).toBe(1)
  expect(first.state.budget).toBe(3)
  expect(tutorialView(first.state).players[0]?.modelAnalysisCompleted).toBe(true)
  expect(advanceTutorial(first.state, wrong).thesisFeedback).toBeUndefined()
  const reset = advanceTutorial(first.state, { type: 'restart-exercise' }).state
  expect(reset.step).toBe('round-1-working-model')
  expect(reset.privateTheses).toEqual([])
  expect(reset.workingModel.signals.aster).toBeUndefined()
  expect(reset.budget).toBe(3)
})

test('independent hints explain method without preselecting Cinder or checking its draft', () => {
  const state = independentThesis()
  const hint = advanceTutorial(state, { type: 'request-hint' })
  expect(hint.state.workingModel).toEqual(state.workingModel)
  expect(hint.state.privateTheses).toEqual(state.privateTheses)
  expect(hint.thesisFeedback).toBeUndefined()
  expect(hint.state.independentCycle).toBe(false)
  expect(tutorialView(hint.state).privateMeasurements).toHaveLength(1)
  expect(tutorialView(hint.state).publicScientificJournal?.at(-1)).toMatchObject({ sourceSignal: 'boreal', receiverSignal: 'cinder', protocol: 'impulse', publicResult: 'unstable_collapse' })
})

test('two wrong independent Theses charge the second Budget, exhaust the round and reset only this exercise', () => {
  const original = independentThesis()
  const wrong = { type: 'submit-thesis', signalId: 'cinder', fieldType: 'inertial', polarity: 'positive' } as const
  const first = advanceTutorial(original, wrong).state
  const second = advanceTutorial(first, wrong).state
  expect(second.budget).toBe(3)
  expect(second.privateTheses).toHaveLength(3)
  expect(second.independentCycle).toBe(false)
  expect(advanceTutorial(second, wrong).thesisFeedback).toBeUndefined()
  const reset = advanceTutorial(second, { type: 'restart-exercise' }).state
  expect(reset.budget).toBe(4)
  expect(reset.privateTheses).toHaveLength(1)
  expect(reset.workingModel.signals.aster?.hypothesis).toBeDefined()
  expect(reset.workingModel.signals.cinder).toBeUndefined()
})

test('closing a correction Journal flushes the actual draft even when its Thesis step did not change', () => {
  const state = independentThesis()
  const corrected = { signals: { cinder: { hypothesis: { fieldType: 'phase' as const, polarity: 'negative' as const } } } }
  const closed = advanceTutorial(state, { type: 'close-journal', workingModel: corrected })
  expect(closed.state.step).toBe('round-2-thesis')
  expect(closed.state.workingModel).toEqual(corrected)
  expect(closed.thesisFeedback).toBeUndefined()
})

test('final draft remains independent, permits wrong partial claims and rejects empty submissions or missing independent practice', () => {
  const independent = run(independentThesis(), [{ type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' }, { type: 'continue' }, { type: 'request-access-slot', slot: 3 }, { type: 'allocate-power', allocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 0, contracts: 0, reserve: 4 } }])
  expect(independent.step).toBe('final-model')
  expect(advanceTutorial(independent, { type: 'submit-scientific-model', scientificModel: { signals: {} } }).progressed).toBe(false)
  const wrong = { signals: { aster: { fieldType: 'phase' as const } } }
  const edited = advanceTutorial(independent, { type: 'update-scientific-model-draft', scientificModelDraft: wrong }).state
  expect(edited.workingModel).toEqual(independent.workingModel)
  expect(edited.finalDraft).toEqual(wrong)
  const submitted = advanceTutorial(edited, { type: 'submit-scientific-model', scientificModel: wrong })
  expect(submitted.state.step).toBe('complete')
  expect(submitted.state.rating).toBe(0)
  expect(advanceTutorial({ ...edited, independentCycle: false }, { type: 'submit-scientific-model', scientificModel: wrong }).progressed).toBe(false)
})
