import { expect, test } from 'bun:test'

import { createTutorialState } from '../src/features/tutorial/scenario'
import {
  clearTutorialSession,
  loadTutorialSession,
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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
