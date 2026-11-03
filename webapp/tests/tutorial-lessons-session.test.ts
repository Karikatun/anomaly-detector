import { expect, test } from 'bun:test'
import { createAdditionalTutorialState } from '../src/features/tutorial/additional-scenario'
import { createTutorialState } from '../src/features/tutorial/scenario'
import { beginGuestTutorialHandoff, claimGuestTutorialHandoff, clearTutorialSession, finishGuestTutorialHandoff, guestTutorialPlayerId, loadTutorialSessionResult, prepareTutorialEntry, saveTutorialSession } from '../src/features/tutorial/session'

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('base and additional drafts are independently versioned and clearing either preserves the other actor and lesson', () => {
  const storage = new MemoryStorage()
  const base = { ...createTutorialState('player-a'), step: 'round-1-access' as const }
  const additional = { ...createAdditionalTutorialState('player-a'), step: 'plan' as const }
  const other = { ...createAdditionalTutorialState('player-b'), step: 'access' as const }
  saveTutorialSession(storage, base)
  saveTutorialSession(storage, additional)
  saveTutorialSession(storage, other)
  expect(loadTutorialSessionResult(storage, 'player-a').state).toEqual(base)
  expect(loadTutorialSessionResult(storage, 'player-a', 'additional').state).toEqual(additional)
  clearTutorialSession(storage, 'player-a', 'additional')
  expect(loadTutorialSessionResult(storage, 'player-a').state).toEqual(base)
  expect(loadTutorialSessionResult(storage, 'player-a', 'additional').state.step).toBe('intro')
  expect(loadTutorialSessionResult(storage, 'player-b', 'additional').state).toEqual(other)
})

test('selected additional handoff claims and consumes only its own run; another pending lesson remains with its first account', () => {
  const storage = new MemoryStorage()
  const base = { ...createTutorialState(guestTutorialPlayerId), step: 'complete' as const, independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } } }
  const additional = { ...createAdditionalTutorialState(guestTutorialPlayerId), step: 'complete' as const, reviewCompleted: true, recoveryCompleted: true, ordinaryAccepted: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } }, publicFinalContract: { contractId: 'final-contract', kind: 'final' as const, requiredPublicResult: 'reflection' as const, reservedByPlayerId: guestTutorialPlayerId, awardedToPlayerId: guestTutorialPlayerId, bidOutcome: 'awarded' as const } }
  saveTutorialSession(storage, base)
  saveTutorialSession(storage, additional)
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  expect(beginGuestTutorialHandoff(storage, 'additional')).toBe(true)
  const baseClaim = claimGuestTutorialHandoff(storage, 'player-a')!
  const additionalClaim = claimGuestTutorialHandoff(storage, 'player-a', 'additional')!
  expect(additionalClaim.command).toEqual({ kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' })
  expect(additionalClaim.handoffId).not.toBe(baseClaim.handoffId)
  finishGuestTutorialHandoff(storage, 'player-a', additionalClaim.handoffId, 'additional')
  expect(claimGuestTutorialHandoff(storage, 'player-a', 'additional')).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-a')).toEqual(baseClaim)
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId).state).toEqual(base)
  expect(loadTutorialSessionResult(storage, 'player-a', 'additional').completionCommand).toEqual(additionalClaim.command)
  prepareTutorialEntry(storage, 'player-a', 'additional')
  expect(loadTutorialSessionResult(storage, 'player-a', 'additional').completionCommand).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-a')).toEqual(baseClaim)
})

test('a receipt for another lesson, unknown version or actor cannot become selected completion or legacy credit', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:tutorial:base:completion:player-a', JSON.stringify({ playerId: 'player-a', command: { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' } }))
  expect(loadTutorialSessionResult(storage, 'player-a').completionCommand).toBeNull()
  storage.setItem('anomaly-detector:tutorial:additional:completion:player-a', JSON.stringify({ playerId: 'player-a', command: { kind: 'legacy-credit' } }))
  expect(loadTutorialSessionResult(storage, 'player-a', 'additional')).toMatchObject({ completionCommand: null, legacyCompleted: false })
  const key = 'anomaly-detector:tutorial:additional:additional-standard-v1:player-a'
  for (const patch of [{ playerId: 'player-b' }, { scenarioVersion: 'unknown' }, { lessonId: 'base' }, { step: 'complete' }, { modelScore: 22 }]) {
    storage.setItem(key, JSON.stringify({ ...createAdditionalTutorialState('player-a'), ...patch }))
    expect(loadTutorialSessionResult(storage, 'player-a', 'additional')).toMatchObject({ state: { step: 'intro', playerId: 'player-a' }, completionCommand: null, legacyCompleted: false })
  }
})


test('claiming only the selected additional lesson binds an unmarked live base completion to its first account without consuming it', () => {
  const storage = new MemoryStorage()
  const base = { ...createTutorialState(guestTutorialPlayerId), step: 'complete' as const, independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } } }
  const additional = { ...createAdditionalTutorialState(guestTutorialPlayerId), step: 'complete' as const, reviewCompleted: true, recoveryCompleted: true, ordinaryAccepted: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } }, publicFinalContract: { contractId: 'final-contract', kind: 'final' as const, requiredPublicResult: 'reflection' as const, reservedByPlayerId: guestTutorialPlayerId, awardedToPlayerId: guestTutorialPlayerId, bidOutcome: 'awarded' as const } }
  saveTutorialSession(storage, base)
  saveTutorialSession(storage, additional)
  expect(beginGuestTutorialHandoff(storage, 'additional')).toBe(true)
  const selected = claimGuestTutorialHandoff(storage, 'player-a', 'additional')!
  finishGuestTutorialHandoff(storage, 'player-a', selected.handoffId, 'additional')
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId).state).toEqual(base)
  expect(loadTutorialSessionResult(storage, 'player-a').completionCommand).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-a')?.command).toEqual({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
})


for (const markedSibling of [false, true]) {
  test(`first-account ownership survives a sibling binding write failure and fresh storage wrapper; marked=${markedSibling}`, () => {
    const first = new MemoryStorage()
    const base = { ...createTutorialState(guestTutorialPlayerId), step: 'complete' as const, independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } } }
    const additional = { ...createAdditionalTutorialState(guestTutorialPlayerId), step: 'complete' as const, reviewCompleted: true, recoveryCompleted: true, ordinaryAccepted: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } }, publicFinalContract: { contractId: 'final-contract', kind: 'final' as const, requiredPublicResult: 'reflection' as const, reservedByPlayerId: guestTutorialPlayerId, awardedToPlayerId: guestTutorialPlayerId, bidOutcome: 'awarded' as const } }
    saveTutorialSession(first, base)
    saveTutorialSession(first, additional)
    if (markedSibling) expect(beginGuestTutorialHandoff(first)).toBe(true)
    expect(beginGuestTutorialHandoff(first, 'additional')).toBe(true)
    const originalSet = first.setItem.bind(first)
    first.setItem = (key, value) => {
      if (key === 'anomaly-detector:tutorial:base:handoff:v1' && JSON.parse(value).userId === 'player-a') throw new DOMException('quota', 'QuotaExceededError')
      originalSet(key, value)
    }
    const selected = claimGuestTutorialHandoff(first, 'player-a', 'additional')
    expect(selected?.command).toEqual({ kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' })
    // A real reload gets a fresh Storage wrapper: no WeakMap/WeakSet memory survives.
    const reloaded = new MemoryStorage()
    reloaded.values = first.values
    expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
    expect(claimGuestTutorialHandoff(reloaded, 'player-a')?.command).toEqual({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
    expect(loadTutorialSessionResult(reloaded, guestTutorialPlayerId).state).toEqual(base)
    expect(loadTutorialSessionResult(reloaded, 'player-a').completionCommand).toBeNull()
    expect(claimGuestTutorialHandoff(reloaded, 'player-a', 'additional')?.handoffId).toBe(selected?.handoffId)
  })
}


test('canonical handoffs migrate old markers once and selected tombstones never revive stale legacy keys', () => {
  const storage = new MemoryStorage()
  const base = { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1', handoffId: crypto.randomUUID(), userId: 'player-a' }
  const additional = { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1', handoffId: crypto.randomUUID(), userId: null }
  storage.setItem('anomaly-detector:tutorial:base:handoff:v1', JSON.stringify(base))
  storage.setItem('anomaly-detector:tutorial:additional:handoff:v1', JSON.stringify(additional))
  const selected = claimGuestTutorialHandoff(storage, 'player-a', 'additional')!
  expect(selected.handoffId).toBe(additional.handoffId)
  storage.setItem('anomaly-detector:tutorial:base:handoff:v1', JSON.stringify({ ...base, userId: null }))
  finishGuestTutorialHandoff(storage, 'player-a', selected.handoffId, 'additional')
  // A late older writer can restore a physical key but cannot defeat the canonical tombstone.
  storage.setItem('anomaly-detector:tutorial:additional:handoff:v1', JSON.stringify(additional))
  const reloaded = new MemoryStorage()
  reloaded.values = storage.values
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(reloaded, 'player-a')?.handoffId).toBe(base.handoffId)
  expect(claimGuestTutorialHandoff(reloaded, 'player-a', 'additional')).toBeNull()
  expect(loadTutorialSessionResult(reloaded, 'player-a', 'additional').completionCommand?.kind).toBe('scenario-completed')
})

test('a present invalid canonical envelope cannot be rewritten by begin or revive an older completed draft', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete', independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' } } } })
  storage.setItem('anomaly-detector:tutorial:base:handoff:v1', JSON.stringify({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1', handoffId: crypto.randomUUID(), userId: null }))
  for (const value of ['{bad', JSON.stringify({ schemaVersion: 2, base: null, additional: null }), JSON.stringify({ schemaVersion: 1, base: null, additional: null, unknown: true })]) {
    storage.setItem('anomaly-detector:tutorial:handoffs:v1', value)
    expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
    expect(beginGuestTutorialHandoff(storage)).toBe(false)
    expect(storage.getItem('anomaly-detector:tutorial:handoffs:v1')).toBe(value)
    expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  }
})


test('a consumed guest run cannot be reconstructed by another account when removing its completed draft fails', () => {
  const storage = new MemoryStorage()
  const guestKey = 'anomaly-detector:tutorial:base:base-simple-v1:tutorial-guest'
  const base = { ...createTutorialState(guestTutorialPlayerId), step: 'complete' as const, independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } } }
  saveTutorialSession(storage, base)
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  const first = claimGuestTutorialHandoff(storage, 'player-a')!
  const remove = storage.removeItem.bind(storage)
  storage.removeItem = (key) => { if (key === guestKey) throw new DOMException('blocked', 'SecurityError'); remove(key) }
  finishGuestTutorialHandoff(storage, 'player-a', first.handoffId)
  const reloaded = new MemoryStorage()
  reloaded.values = storage.values
  expect(loadTutorialSessionResult(reloaded, guestTutorialPlayerId).state.step).toBe('complete')
  expect(beginGuestTutorialHandoff(reloaded)).toBe(false)
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
  expect(loadTutorialSessionResult(reloaded, 'player-a').completionCommand).toEqual(first.command)
  // Explicit repeat may reopen this lesson only after its old terminal draft was discarded.
  clearTutorialSession(reloaded, guestTutorialPlayerId)
  saveTutorialSession(reloaded, createTutorialState(guestTutorialPlayerId))
  expect(loadTutorialSessionResult(reloaded, guestTutorialPlayerId).state.step).toBe('prologue')
  expect(beginGuestTutorialHandoff(reloaded)).toBe(false)
})

test('failed explicit repeat removal cannot revive the prior consumed run after reload', () => {
  const storage = new MemoryStorage()
  const key = 'anomaly-detector:tutorial:base:base-simple-v1:tutorial-guest'
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete', independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' } } } })
  beginGuestTutorialHandoff(storage)
  const first = claimGuestTutorialHandoff(storage, 'player-a')!
  const remove = storage.removeItem.bind(storage)
  storage.removeItem = (name) => { if (name === key) throw new DOMException('blocked', 'SecurityError'); remove(name) }
  finishGuestTutorialHandoff(storage, 'player-a', first.handoffId)
  const repeatStorage = new MemoryStorage()
  repeatStorage.values = storage.values
  const repeatRemove = repeatStorage.removeItem.bind(repeatStorage)
  repeatStorage.removeItem = (name) => { if (name === key) throw new DOMException('blocked', 'SecurityError'); repeatRemove(name) }
  clearTutorialSession(repeatStorage, guestTutorialPlayerId)
  const reloaded = new MemoryStorage()
  reloaded.values = storage.values
  expect(beginGuestTutorialHandoff(reloaded)).toBe(false)
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
})


test('a later legacy origin inherits the consumed current run actor instead of becoming an unowned transfer', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete', independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' } } } })
  beginGuestTutorialHandoff(storage)
  const actual = claimGuestTutorialHandoff(storage, 'player-a')!
  finishGuestTutorialHandoff(storage, 'player-a', actual.handoffId)
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify({ budget: 3, corporateTrust: 0, hintLevel: 0, playerId: guestTutorialPlayerId, privateTheses: [], rating: 1, round: 2, step: 'complete', thesisAttempts: 0, workingModel: { signals: {} } }))
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  const historical = claimGuestTutorialHandoff(storage, 'player-a')!
  expect(historical.command).toEqual({ kind: 'legacy-credit' })
  finishGuestTutorialHandoff(storage, 'player-a', historical.handoffId)
  expect(loadTutorialSessionResult(storage, 'player-a').completionCommand).toEqual(actual.command)
})


test('legacy cleanup failure preserves first ownership through explicit repeat and a fresh modern draft', () => {
  const first = new MemoryStorage()
  saveTutorialSession(first, { ...createTutorialState(guestTutorialPlayerId), step: 'complete', independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' } } } })
  beginGuestTutorialHandoff(first)
  const actual = claimGuestTutorialHandoff(first, 'player-a')!
  finishGuestTutorialHandoff(first, 'player-a', actual.handoffId)
  first.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify({ budget: 3, corporateTrust: 0, hintLevel: 0, playerId: guestTutorialPlayerId, privateTheses: [], rating: 1, round: 2, step: 'complete', thesisAttempts: 0, workingModel: { signals: {} } }))
  const reset = new MemoryStorage()
  reset.values = first.values
  const remove = reset.removeItem.bind(reset)
  reset.removeItem = (key) => { if (key === 'anomaly-detector:guest-tutorial-session') throw new DOMException('blocked', 'SecurityError'); remove(key) }
  clearTutorialSession(reset, guestTutorialPlayerId)
  saveTutorialSession(reset, createTutorialState(guestTutorialPlayerId))
  const reloaded = new MemoryStorage()
  reloaded.values = first.values
  expect(loadTutorialSessionResult(reloaded, guestTutorialPlayerId).state.step).toBe('prologue')
  expect(beginGuestTutorialHandoff(reloaded)).toBe(true)
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(reloaded, 'player-a')?.command).toEqual({ kind: 'legacy-credit' })
})


test('saving a fresh incomplete modern draft alone retains the owner of a still-pending legacy origin', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete', independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' } } } })
  beginGuestTutorialHandoff(storage)
  const actual = claimGuestTutorialHandoff(storage, 'player-a')!
  finishGuestTutorialHandoff(storage, 'player-a', actual.handoffId)
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify({ budget: 3, corporateTrust: 0, hintLevel: 0, playerId: guestTutorialPlayerId, privateTheses: [], rating: 1, round: 2, step: 'complete', thesisAttempts: 0, workingModel: { signals: {} } }))
  saveTutorialSession(storage, createTutorialState(guestTutorialPlayerId))
  const reloaded = new MemoryStorage()
  reloaded.values = storage.values
  expect(beginGuestTutorialHandoff(reloaded)).toBe(true)
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(reloaded, 'player-a')?.command).toEqual({ kind: 'legacy-credit' })
})
