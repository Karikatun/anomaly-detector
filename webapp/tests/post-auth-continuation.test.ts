import { expect, test } from 'bun:test'

import {
  capturePostAuthContinuation,
  consumePostAuthContinuation,
  peekPostAuthContinuation,
} from '../src/features/auth/post-auth-continuation'

test('captures and consumes only the bounded tutorial continuation', () => {
  const storage = new MemoryStorage()

  expect(capturePostAuthContinuation(storage, new URL('https://app.example/?continue=tutorial'))).toBe('tutorial')
  expect(peekPostAuthContinuation(storage)).toBe('tutorial')
  expect(consumePostAuthContinuation(storage)).toBe('/tutorial')
  expect(peekPostAuthContinuation(storage)).toBeNull()
})

test('ignores arbitrary redirect values and clears stale browser data', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:post-auth-continuation', 'https://attacker.example')

  expect(capturePostAuthContinuation(storage, new URL('https://app.example/?continue=admin'))).toBeNull()
  expect(peekPostAuthContinuation(storage)).toBeNull()
  expect(consumePostAuthContinuation(storage)).toBeNull()
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
