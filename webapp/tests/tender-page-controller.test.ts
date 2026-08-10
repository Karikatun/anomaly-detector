import { expect, test } from 'bun:test'

import {
  createExclusiveActionGate,
  sequentialTurnKey,
  shouldFocusSequentialTurn,
  shouldResumeTender,
  visibleCommandError,
} from '../src/features/tender/tender-page-controller'

test('shares one command promise while an action is in flight and resets after settlement', async () => {
  let resolveAction = () => {}
  let executions = 0
  let starts = 0
  let finishes = 0
  const gate = createExclusiveActionGate()
  const action = () => {
    executions += 1
    return new Promise<void>((resolve) => { resolveAction = resolve })
  }
  const callbacks = { onFinish: () => { finishes += 1 }, onStart: () => { starts += 1 } }

  const first = gate.run(action, callbacks)
  const duplicate = gate.run(action, callbacks)
  expect(duplicate).toBe(first)
  expect({ executions, starts }).toEqual({ executions: 1, starts: 1 })
  resolveAction()
  await first
  await gate.run(async () => { executions += 1 }, callbacks)
  expect({ executions, finishes, starts }).toEqual({ executions: 2, finishes: 2, starts: 2 })
})

test('resumes only a connected left Tender without an active leave or resume request', () => {
  expect(shouldResumeTender({
    connected: true,
    hasLeft: true,
    leavingTenderId: null,
    resumingTenderId: null,
    tenderId: 'tender-1',
  })).toBe(true)
  expect(shouldResumeTender({
    connected: true,
    hasLeft: true,
    leavingTenderId: 'tender-1',
    resumingTenderId: null,
    tenderId: 'tender-1',
  })).toBe(false)
})

test('focuses a new sequential turn only when it becomes the current player turn', () => {
  const phases = new Set(['laboratory'])
  const previousTurnKey = sequentialTurnKey('laboratory', 'other', phases)
  const currentTurnKey = sequentialTurnKey('laboratory', 'me', phases)

  expect(shouldFocusSequentialTurn({
    activePlayerId: 'me',
    currentTurnKey,
    currentUserId: 'me',
    previousTurnKey,
  })).toBe(true)
})

test('hides stale command errors after the authoritative view advances', () => {
  const error = { message: 'conflict', version: 4 }
  expect(visibleCommandError(error, 4)).toBe('conflict')
  expect(visibleCommandError(error, 5)).toBeNull()
})
