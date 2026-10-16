import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'

import {
  advanceTutorial,
  createTutorialState,
  tutorialContractId,
  tutorialView,
} from '../src/features/tutorial/scenario'

const expectedRoundOnePower = {
  contracts: 0,
  laboratory: 2,
  modelAnalysis: 1,
  reconnaissance: 1,
}

const expectedRoundTwoPower = {
  contracts: 1,
  laboratory: 1,
  modelAnalysis: 1,
  reconnaissance: 1,
}

test('player completes the deterministic two-round tutorial through real Tender actions', () => {
  let state = createTutorialState('player-a')

  expect(state.step).toBe('prologue')
  state = advanceTutorial(state, { type: 'start-tutorial' }).state
  expect(state.step).toBe('round-1-access')

  const wrongSlot = advanceTutorial(state, { type: 'request-access-slot', slot: 1 })
  expect(wrongSlot.progressed).toBe(false)
  expect(wrongSlot.state.step).toBe('round-1-access')

  state = advanceTutorial(state, { type: 'request-access-slot', slot: 5 }).state
  expect(state.step).toBe('round-1-power')
  state = advanceTutorial(state, { type: 'allocate-power', allocation: expectedRoundOnePower }).state
  expect(state.step).toBe('round-1-recon')
  state = advanceTutorial(state, { type: 'conduct-reconnaissance', targets: ['unknown-sector'] }).state
  expect(state.step).toBe('round-1-lab-mode')
  state = advanceTutorial(state, { type: 'select-laboratory-mode', mode: 'deep' }).state
  expect(state.step).toBe('round-1-lab-pair')
  state = advanceTutorial(state, {
    type: 'run-laboratory-test',
    laboratory: {
      mode: 'deep',
      pair: { sourceSignal: 'aster', receiverSignal: 'boreal' },
    },
  }).state

  expect(state.step).toBe('research-results')
  state = advanceTutorial(state, { type: 'open-research-results' }).state
  expect(state.step).toBe('research-results-open')
  state = advanceTutorial(state, { type: 'open-interpretation' }).state
  expect(state.step).toBe('interpretation-open')
  state = advanceTutorial(state, { type: 'open-working-model' }).state
  state = advanceTutorial(state, {
    type: 'update-working-model',
    workingModel: {
      signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } } },
    },
  }).state
  state = advanceTutorial(state, { type: 'close-research-results' }).state
  state = advanceTutorial(state, {
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'inertial',
    polarity: 'positive',
  }).state

  expect(state.step).toBe('round-2-access')
  expect(state.round).toBe(2)

  state = advanceTutorial(state, { type: 'request-access-slot', slot: 4 }).state
  expect(state.step).toBe('round-2-contracts-review')
  expect(tutorialView(state).publicContracts.map((contract) => contract.planning?.eligible)).toEqual([true, false])
  state = advanceTutorial(state, { type: 'open-contracts-review' }).state
  expect(state.step).toBe('round-2-contracts-review-open')
  state = advanceTutorial(state, { type: 'close-contracts-review' }).state
  expect(state.step).toBe('round-2-power')
  state = advanceTutorial(state, { type: 'allocate-power', allocation: expectedRoundTwoPower }).state
  state = advanceTutorial(state, { type: 'conduct-reconnaissance', targets: ['unknown-sector'] }).state
  state = advanceTutorial(state, {
    type: 'run-laboratory-test',
    laboratory: {
      mode: 'impulse',
      pair: { sourceSignal: 'boreal', receiverSignal: 'cinder' },
    },
  }).state
  expect(state.step).toBe('round-2-research')
  state = advanceTutorial(state, { type: 'open-research-results' }).state
  state = advanceTutorial(state, { type: 'open-working-model' }).state
  state = advanceTutorial(state, {
    type: 'update-working-model',
    workingModel: {
      signals: {
        aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } },
        boreal: { hypothesis: { fieldType: 'electromagnetic', polarity: 'positive' } },
      },
    },
  }).state
  state = advanceTutorial(state, { type: 'close-research-results' }).state
  state = advanceTutorial(state, {
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'electromagnetic',
    polarity: 'positive',
  }).state
  expect(state.step).toBe('round-2-contract-reserve')
  state = advanceTutorial(state, { type: 'reserve-contract', contractId: tutorialContractId }).state
  state = advanceTutorial(state, {
    type: 'submit-contract-bid',
    contractId: tutorialContractId,
    evidenceTestIds: ['tutorial-test-2'],
  }).state

  expect(state.step).toBe('final-model')
  const completed = advanceTutorial(state, {
    type: 'submit-scientific-model',
    scientificModel: {
      signals: {
        aster: { fieldType: 'inertial', polarity: 'positive' },
        boreal: { fieldType: 'electromagnetic', polarity: 'positive' },
      },
    },
  })
  expect(completed.progressed).toBe(true)
  expect(completed.state.step).toBe('complete')
})

test('wrong Thesis returns separate feedback and progressively reveals a hint without penalty', () => {
  const state = {
    ...createTutorialState('player-a'),
    step: 'round-1-thesis' as const,
  }
  const first = advanceTutorial(state, {
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'phase',
    polarity: 'negative',
  })
  expect(first.progressed).toBe(false)
  expect(first.thesisFeedback).toEqual({ fieldTypeCorrect: false, polarityCorrect: false })
  expect(first.state.thesisAttempts).toBe(1)
  expect(first.state.hintLevel).toBe(0)

  const second = advanceTutorial(first.state, {
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'electromagnetic',
    polarity: 'negative',
  })
  expect(second.state.thesisAttempts).toBe(2)
  expect(second.state.hintLevel).toBe(1)
  expect(second.state.rating).toBe(0)
  expect(second.state.budget).toBe(first.state.budget)
})

test('saving a tutorial hypothesis preserves the draft without checking it or advancing to a Thesis', () => {
  const state = { ...createTutorialState('player-a'), step: 'round-1-working-model' as const }
  const workingModel = { signals: { aster: { hypothesis: { fieldType: 'phase' as const, polarity: 'negative' as const } } } }
  const saved = advanceTutorial(state, { type: 'update-working-model', workingModel })
  expect(saved.state.workingModel).toEqual(workingModel)
  expect(saved.state.step).toBe('round-1-working-model')
  expect(saved.state.privateTheses).toEqual([])
  expect(saved.thesisFeedback).toBeUndefined()
  const closed = advanceTutorial(saved.state, { type: 'close-research-results' })
  expect(closed.state.step).toBe('round-1-thesis')
  expect(closed.state.privateTheses).toEqual([])
})

test('the first laboratory result enters Analysis and teaches the Journal tabs in one reading session', () => {
  const afterTest = advanceTutorial({ ...createTutorialState('player-a'), step: 'round-1-lab-pair' }, {
    type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } },
  }).state
  expect(afterTest.step).toBe('research-results')
  expect(tutorialView(afterTest).phase).toBe('model-analysis')
  const opened = advanceTutorial(afterTest, { type: 'open-research-results' }).state
  expect(advanceTutorial(opened, { type: 'close-research-results' }).state.step).toBe('research-results')
  const interpretation = advanceTutorial(opened, { type: 'open-interpretation' }).state
  expect(interpretation.step).toBe('interpretation-open')
  const model = advanceTutorial(interpretation, { type: 'open-working-model' }).state
  expect(model.step).toBe('round-1-working-model')
  expect(model.privateTheses).toEqual([])
})

test('closing a reading Journal early returns to a manual entry without losing data or submitting a Thesis', () => {
  const state = { ...createTutorialState('player-a'), step: 'research-results-open' as const }
  const closed = advanceTutorial(state, { type: 'close-journal', workingModel: state.workingModel }).state
  expect(closed.step).toBe('research-results')
  expect(closed.privateTheses).toEqual([])
  expect(tutorialView(closed).publicScientificJournal).toHaveLength(1)
  const second = { ...state, round: 2 as const, step: 'round-2-research-open' as const }
  expect(advanceTutorial(second, { type: 'close-journal', workingModel: second.workingModel }).state.step).toBe('round-2-research')
})

test('orientation text is attached to the actual first actions instead of Next-only pauses', () => {
  let state = advanceTutorial(createTutorialState('player-a'), { type: 'start-tutorial' }).state
  expect(state.step).toBe('round-1-access')
  state = advanceTutorial(state, { type: 'request-access-slot', slot: 5 }).state
  expect(state.step).toBe('round-1-power')
  state = advanceTutorial(state, { type: 'allocate-power', allocation: expectedRoundOnePower }).state
  expect(state.step).toBe('round-1-recon')
  state = advanceTutorial(state, { type: 'conduct-reconnaissance', targets: ['unknown-sector'] }).state
  expect(state.step).toBe('round-1-lab-mode')
})

test('tutorial projects valid participant-scoped Tender views without timers or hidden configuration', () => {
  const initial = tutorialView(createTutorialState('player-a'))
  expect(tenderViewSchema.parse(initial)).toEqual(initial)
  expect(initial.phase).toBe('access-slot-selection')
  expect(initial.dueAt).toBeNull()
  expect(initial.players.map((player) => player.displayName)).toEqual(['Исследователь', 'Учебный соперник'])
  expect(initial.knownSignals).toEqual(['aster', 'boreal'])
  expect(initial.publicContracts).toHaveLength(2)
  expect(initial.players.every((player) => player.accessSlot === undefined)).toBe(true)
  expect(initial.players.every((player) => player.requestedAccessSlot === undefined)).toBe(true)
  expect('anomalyConfiguration' in initial).toBe(false)

  const laboratory = tutorialView({
    ...createTutorialState('player-a'),
    step: 'research-results',
  })
  expect(tenderViewSchema.parse(laboratory)).toEqual(laboratory)
  expect(laboratory.publicScientificJournal).toEqual([
    {
      playerId: 'player-a',
      protocol: 'continuous',
      publicResult: 'reflection',
      receiverSignal: 'boreal',
      sourceSignal: 'aster',
      testId: 'tutorial-test-1',
    },
  ])
  expect(laboratory.privateMeasurements).toEqual([
    { receiverSignal: 'boreal', sourceSignal: 'aster', polarityRelation: 'same' },
  ])
  expect(laboratory.publicContracts).toHaveLength(2)
})
