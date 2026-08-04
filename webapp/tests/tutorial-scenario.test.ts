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

  const wrongSlot = advanceTutorial(state, { type: 'request-access-slot', slot: 1 })
  expect(wrongSlot.progressed).toBe(false)
  expect(wrongSlot.state.step).toBe('round-1-access')

  state = advanceTutorial(state, { type: 'request-access-slot', slot: 5 }).state
  state = advanceTutorial(state, { type: 'allocate-power', allocation: expectedRoundOnePower }).state
  state = advanceTutorial(state, { type: 'conduct-reconnaissance', targets: ['unknown-sector'] }).state
  state = advanceTutorial(state, {
    type: 'run-laboratory-test',
    laboratory: {
      mode: 'deep',
      pair: { sourceSignal: 'aster', receiverSignal: 'boreal' },
    },
  }).state

  expect(state.step).toBe('help-menu')
  state = advanceTutorial(state, { type: 'open-help-menu' }).state
  state = advanceTutorial(state, { type: 'open-interpretation' }).state
  expect(state.step).toBe('interpretation-open')
  state = advanceTutorial(state, { type: 'close-interpretation' }).state
  state = advanceTutorial(state, {
    type: 'update-working-model',
    workingModel: {
      signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } } },
    },
  }).state
  state = advanceTutorial(state, {
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'inertial',
    polarity: 'positive',
  }).state

  expect(state.step).toBe('round-2-access')
  expect(state.round).toBe(2)

  state = advanceTutorial(state, { type: 'request-access-slot', slot: 4 }).state
  state = advanceTutorial(state, { type: 'allocate-power', allocation: expectedRoundTwoPower }).state
  state = advanceTutorial(state, { type: 'conduct-reconnaissance', targets: ['unknown-sector'] }).state
  state = advanceTutorial(state, {
    type: 'run-laboratory-test',
    laboratory: {
      mode: 'impulse',
      pair: { sourceSignal: 'boreal', receiverSignal: 'cinder' },
    },
  }).state
  state = advanceTutorial(state, {
    type: 'update-working-model',
    workingModel: {
      signals: {
        aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } },
        boreal: { hypothesis: { fieldType: 'electromagnetic', polarity: 'positive' } },
      },
    },
  }).state
  state = advanceTutorial(state, {
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'electromagnetic',
    polarity: 'positive',
  }).state
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

test('tutorial projects valid participant-scoped Tender views without timers or hidden configuration', () => {
  const initial = tutorialView(createTutorialState('player-a'))
  expect(tenderViewSchema.parse(initial)).toEqual(initial)
  expect(initial.phase).toBe('access-slot-selection')
  expect(initial.dueAt).toBeNull()
  expect(initial.players.map((player) => player.displayName)).toEqual(['Исследователь', 'Учебный соперник'])
  expect('anomalyConfiguration' in initial).toBe(false)

  const laboratory = tutorialView({
    ...createTutorialState('player-a'),
    step: 'help-menu',
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
})
