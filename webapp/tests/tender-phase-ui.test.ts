import { expect, test } from 'bun:test'

import {
  getPhaseContextMenuVisibility,
  getTenderPhaseProgressStages,
  shouldLockPhaseOverlays,
} from '../src/features/tender/phase-ui'

test('shows progress from access selection through final scientific model', () => {
  expect(getTenderPhaseProgressStages('access-slot-selection').map((stage) => stage.phase)).toEqual([
    'access-slot-selection',
    'power-allocation',
    'reconnaissance',
    'laboratory',
    'model-analysis',
    'contracts',
  ])
  expect(getTenderPhaseProgressStages('final-scientific-model').map((stage) => stage.phase)).toEqual([
    'access-slot-selection',
    'power-allocation',
    'reconnaissance',
    'laboratory',
    'model-analysis',
    'contracts',
    'final-scientific-model',
  ])
  expect(getTenderPhaseProgressStages('complete')).toEqual([])
})

test('hides only the agreed contextual menu entries', () => {
  expect(getPhaseContextMenuVisibility('access-slot-selection')).toEqual({
    contracts: true,
    workingModel: true,
  })
  expect(getPhaseContextMenuVisibility('model-analysis')).toEqual({
    contracts: true,
    workingModel: false,
  })
  expect(getPhaseContextMenuVisibility('contracts')).toEqual({
    contracts: false,
    workingModel: true,
  })
  expect(getPhaseContextMenuVisibility('final-scientific-model')).toEqual({
    contracts: false,
    workingModel: false,
  })
})

test('locks every phase overlay during the final ten seconds of an active phase', () => {
  expect(shouldLockPhaseOverlays({ phase: 'laboratory', remainingSeconds: 11 })).toBe(false)
  expect(shouldLockPhaseOverlays({ phase: 'laboratory', remainingSeconds: 10 })).toBe(true)
  expect(shouldLockPhaseOverlays({ phase: 'complete', remainingSeconds: 0 })).toBe(false)
})
