import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'
import { advanceTutorial, createTutorialState, resumeTutorialState, tutorialView, type TutorialAction, type TutorialState } from '../src/features/tutorial/scenario'

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
function checkedThesis() {
  return run(firstThesis(), [{ type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }])
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

test('requesting a hint during Aster analysis neither fills the hypothesis nor checks it', () => {
  const state = run(firstResearch(), [{ type: 'open-research-results' }, { type: 'open-interpretation' }, { type: 'open-working-model' }])
  const hint = advanceTutorial(state, { type: 'request-hint' })
  expect(hint.state.hintLevel).toBe(1)
  expect(hint.state.workingModel).toEqual(state.workingModel)
  expect(hint.state.privateTheses).toEqual(state.privateTheses)
  expect(hint.thesisFeedback).toBeUndefined()
  expect(hint.state.independentCycle).toBe(false)
})

test('closing a correction Journal flushes the actual draft even when its Thesis step did not change', () => {
  const state = firstThesis()
  const corrected = { signals: { aster: { hypothesis: { fieldType: 'phase' as const, polarity: 'negative' as const } } } }
  const closed = advanceTutorial(state, { type: 'close-journal', workingModel: corrected })
  expect(closed.state.step).toBe('round-1-thesis')
  expect(closed.state.workingModel).toEqual(corrected)
  expect(closed.thesisFeedback).toBeUndefined()
})

test('final draft remains independent, permits wrong partial claims and rejects empty submissions or missing independent practice', () => {
  const independent = run(checkedThesis(), [{ type: 'continue' }])
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

test('a restored first-round result can continue using an already recorded correct Aster Thesis', () => {
  const formerResult = { ...checkedThesis(), independentCycle: false }
  const restored = resumeTutorialState(formerResult)
  expect(advanceTutorial(restored, { type: 'continue' }).state.step).toBe('final-model')
  const withoutThesis = resumeTutorialState({ ...formerResult, privateTheses: [] })
  expect(advanceTutorial(withoutThesis, { type: 'continue' }).progressed).toBe(false)
})
