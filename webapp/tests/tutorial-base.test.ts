import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'

import { advanceTutorial, createTutorialState, tutorialView, type TutorialAction } from '../src/features/tutorial/scenario'

test('base practice checks a learner-owned Cinder hypothesis and scores only their explicitly submitted model', () => {
  let state = createTutorialState('learner')
  const act = (action: TutorialAction) => {
    const result = advanceTutorial(state, action)
    state = result.state
    return result
  }
  act({ type: 'start-tutorial' })
  expect(act({ type: 'request-access-slot', slot: 6 }).progressed).toBe(true)
  expect(tutorialView(state).game).toEqual({ mode: 'simple', rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' })
  expect(tutorialView(state).publicContracts).toEqual([])
  act({ type: 'allocate-power', allocation: { reconnaissance: 1, laboratory: 2, modelAnalysis: 1, contracts: 0 } })
  act({ type: 'conduct-reconnaissance', targets: ['aster'] })
  act({ type: 'select-laboratory-mode', mode: 'deep' })
  act({ type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } })
  act({ type: 'open-research-results' })
  act({ type: 'open-interpretation' })
  act({ type: 'open-working-model' })
  const aster = { hypothesis: { fieldType: 'inertial' as const, polarity: 'positive' as const } }
  act({ type: 'update-working-model', workingModel: { signals: { aster } } })
  act({ type: 'close-journal', workingModel: state.workingModel })
  expect(act({ type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }).thesisFeedback)
    .toEqual({ fieldTypeCorrect: true, polarityCorrect: true })
  act({ type: 'continue' })
  act({ type: 'request-access-slot', slot: 5 })
  act({ type: 'allocate-power', allocation: { reconnaissance: 0, laboratory: 1, modelAnalysis: 2, contracts: 0, reserve: 1 } })
  act({ type: 'run-laboratory-test', laboratory: { mode: 'impulse', pair: { sourceSignal: 'boreal', receiverSignal: 'cinder' } } })
  act({ type: 'open-research-results' })
  act({ type: 'open-working-model' })
  const wrong = { signals: { aster, cinder: { hypothesis: { fieldType: 'inertial' as const, polarity: 'positive' as const } } } }
  const saved = act({ type: 'update-working-model', workingModel: wrong })
  expect(saved.thesisFeedback).toBeUndefined()
  expect(state.privateTheses).toHaveLength(1)
  expect(state.workingModel).toEqual(wrong)
  act({ type: 'close-journal', workingModel: state.workingModel })
  const first = act({ type: 'submit-thesis', signalId: 'cinder', fieldType: 'inertial', polarity: 'positive' })
  expect(first.thesisFeedback).toEqual({ fieldTypeCorrect: false, polarityCorrect: false })
  const budgetBeforeRetry = state.budget
  act({ type: 'update-working-model', workingModel: { signals: { aster, cinder: { hypothesis: { fieldType: 'phase', polarity: 'negative' } } } } })
  expect(act({ type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' }).thesisFeedback)
    .toEqual({ fieldTypeCorrect: true, polarityCorrect: true })
  expect(state.budget).toBe(budgetBeforeRetry - 1)
  act({ type: 'continue' })
  act({ type: 'request-access-slot', slot: 3 })
  act({ type: 'allocate-power', allocation: { reconnaissance: 0, laboratory: 1, modelAnalysis: 0, contracts: 0, reserve: 3 } })
  act({ type: 'run-laboratory-test', laboratory: { mode: 'impulse', pair: { sourceSignal: 'aster', receiverSignal: 'cinder' } } })
  const final = tutorialView(state)
  expect(final.phase).toBe('final-scientific-model')
  expect(final.privateFinalScientificModelDraft).toEqual({ signals: {
    aster: { fieldType: 'inertial', polarity: 'positive' }, cinder: { fieldType: 'phase', polarity: 'negative' },
  } })
  expect(tenderViewSchema.parse(final)).toEqual(final)
  act({ type: 'submit-scientific-model', scientificModel: final.privateFinalScientificModelDraft! })
  expect(state.step).toBe('complete')
  expect(state.rating).toBe(4)
})
