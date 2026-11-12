import { expect, test } from 'bun:test'
import { tenderViewSchema } from '@anomaly-detector/contracts'

import { advanceTutorial, createTutorialState, tutorialView, type TutorialAction } from '../src/features/tutorial/scenario'

test('base practice plays one full round, then scores only the explicitly submitted final model', () => {
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
  expect(act({ type: 'allocate-power', allocation: { reconnaissance: 1, laboratory: 2, modelAnalysis: 1, contracts: 0 } }).progressed).toBe(true)
  expect(act({ type: 'conduct-reconnaissance', targets: ['aster'] }).progressed).toBe(true)
  expect(act({ type: 'select-laboratory-mode', mode: 'deep' }).progressed).toBe(true)
  expect(act({ type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } }).progressed).toBe(true)
  expect(act({ type: 'open-research-results' }).progressed).toBe(true)
  expect(act({ type: 'open-interpretation' }).progressed).toBe(true)
  expect(act({ type: 'open-working-model' }).progressed).toBe(true)
  expect(state.workingModel.signals).toEqual({})
  const aster = { hypothesis: { fieldType: 'inertial' as const, polarity: 'positive' as const } }
  const saved = act({ type: 'update-working-model', workingModel: { signals: { aster } } })
  expect(saved.thesisFeedback).toBeUndefined()
  expect(state.privateTheses).toHaveLength(0)
  expect(act({ type: 'close-journal', workingModel: state.workingModel }).progressed).toBe(true)
  expect(act({ type: 'continue' }).progressed).toBe(false)
  expect(act({ type: 'submit-scientific-model', scientificModel: { signals: { aster: aster.hypothesis } } }).progressed).toBe(false)
  const thesis = { signalId: 'aster', fieldType: 'inertial', polarity: 'positive' } as const
  expect(act({ type: 'submit-thesis', ...thesis }).progressed).toBe(false)
  expect(act({ type: 'prepare-thesis', ...thesis, fieldType: 'phase' }).progressed).toBe(true)
  expect(state.step).toBe('round-1-thesis-review')
  expect(state.thesisDraft).toEqual({ ...thesis, fieldType: 'phase' })
  expect(state.privateTheses).toEqual([])
  expect(act({ type: 'update-thesis-draft', draft: { ...thesis, polarity: '' } }).progressed).toBe(false)
  expect(state.thesisDraft).toEqual({ ...thesis, polarity: '' })
  expect(state.privateTheses).toEqual([])
  expect(act({ type: 'submit-thesis', ...thesis }).thesisFeedback)
    .toEqual({ fieldTypeCorrect: true, polarityCorrect: true })
  expect(state.step).toBe('round-1-thesis-result')
  expect(state.finalSubmission).toBeNull()
  expect(state.budget).toBe(3)
  act({ type: 'update-working-model', workingModel: { signals: { aster: { hypothesis: { fieldType: 'phase', polarity: 'positive' } } } } })
  expect(act({ type: 'continue' }).progressed).toBe(true)
  const final = tutorialView(state)
  expect(final.phase).toBe('final-scientific-model')
  expect(final.round).toBe(1)
  expect(final.players[0]?.budget).toBe(4)
  expect(final.privateFinalScientificModelDraft).toEqual({ signals: { aster: { fieldType: 'inertial', polarity: 'positive' } } })
  expect(tenderViewSchema.parse(final)).toEqual(final)
  expect(act({ type: 'continue' }).progressed).toBe(false)
  expect(act({ type: 'request-access-slot', slot: 5 }).progressed).toBe(false)
  expect(act({ type: 'submit-scientific-model', scientificModel: { signals: { aster: aster.hypothesis } } }).progressed).toBe(true)
  expect(state.step).toBe('complete')
  expect(state.rating).toBe(2)
})
