import { expect, test } from 'bun:test'

import { createTutorialState } from '../src/features/tutorial/scenario'
import {
  beginGuestTutorialHandoff,
  claimGuestTutorialCompletion,
  clearTutorialSession,
  finishGuestTutorialHandoff,
  guestTutorialPlayerId,
  loadTutorialSession,
  prepareTutorialEntry,
  saveTutorialSession,
} from '../src/features/tutorial/session'

test('tutorial restores only the current player session in the same tab and clears on exit', () => {
  const storage = new MemoryStorage()
  const progressed = { ...createTutorialState('player-a'), step: 'round-2-access' as const, round: 2 as const }
  saveTutorialSession(storage, progressed)

  expect(loadTutorialSession(storage, 'player-a')).toEqual(progressed)
  expect(loadTutorialSession(storage, 'player-b')).toEqual(createTutorialState('player-b'))

  clearTutorialSession(storage)
  expect(loadTutorialSession(storage, 'player-a')).toEqual(createTutorialState('player-a'))
})

test('tutorial ignores malformed browser session data', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:tutorial-session', '{"step":"stale-step"}')
  expect(loadTutorialSession(storage, 'player-a')).toEqual(createTutorialState('player-a'))
})

test('guest progress survives reload without overwriting an account draft', () => {
  const storage = new MemoryStorage()
  const account = { ...createTutorialState('player-a'), step: 'round-2-access' as const, round: 2 as const }
  const guest = { ...createTutorialState(guestTutorialPlayerId), step: 'round-1-access' as const }
  saveTutorialSession(storage, account)
  saveTutorialSession(storage, guest)

  expect(loadTutorialSession(storage, guestTutorialPlayerId)).toEqual(guest)
  expect(loadTutorialSession(storage, 'player-a')).toEqual(account)
  clearTutorialSession(storage, guestTutorialPlayerId)
  expect(loadTutorialSession(storage, guestTutorialPlayerId).step).toBe('prologue')
  expect(loadTutorialSession(storage, 'player-a')).toEqual(account)
})

test('only explicitly continued, completed guest learning can be attached to an account', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, createTutorialState(guestTutorialPlayerId))
  expect(beginGuestTutorialHandoff(storage)).toBe(false)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)

  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete' })
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(true)
})

test('completion retry stays with the first account and is consumed only after its save', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete' })
  beginGuestTutorialHandoff(storage)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(true)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(true)
  expect(claimGuestTutorialCompletion(storage, 'player-b')).toBe(false)
  finishGuestTutorialHandoff(storage, 'player-b')
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(true)

  finishGuestTutorialHandoff(storage, 'player-a')
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)
  expect(claimGuestTutorialCompletion(storage, 'player-b')).toBe(false)
  expect(loadTutorialSession(storage, guestTutorialPlayerId).step).toBe('prologue')
})

test('explicit menu entry restarts a completed lesson and preserves an unfinished draft', () => {
  const storage = new MemoryStorage()
  const unfinished = { ...createTutorialState('player-a'), step: 'round-1-access' as const }
  saveTutorialSession(storage, unfinished)
  prepareTutorialEntry(storage, 'player-a')
  expect(loadTutorialSession(storage, 'player-a')).toEqual(unfinished)
  saveTutorialSession(storage, { ...unfinished, step: 'complete' })
  prepareTutorialEntry(storage, 'player-b')
  expect(loadTutorialSession(storage, 'player-a').step).toBe('complete')
  prepareTutorialEntry(storage, 'player-a')
  expect(loadTutorialSession(storage, 'player-a').step).toBe('prologue')
})

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
