import { expect, test } from 'bun:test'
import { createTutorialState } from '../src/features/tutorial/scenario'
import { beginGuestTutorialHandoff, claimGuestTutorialCompletion, claimGuestTutorialHandoff, clearTutorialSession, finishGuestTutorialHandoff, getTutorialStorage, guestTutorialPlayerId, loadTutorialSession, loadTutorialSessionResult, prepareTutorialEntry, saveTutorialSession } from '../src/features/tutorial/session'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
function completed(playerId = guestTutorialPlayerId) {
  return { ...createTutorialState(playerId), step: 'complete' as const, independentCycle: true, finalSubmission: { signals: { aster: { fieldType: 'inertial' as const } } } }
}
function legacy(playerId = guestTutorialPlayerId, step = 'complete') {
  return { budget: 2, corporateTrust: 0, hintLevel: 0, playerId, privateTheses: [], rating: 0, round: 2, step, thesisAttempts: 0, workingModel: { signals: {} } }
}

test('a reloaded draft retains its current step entry and exact earlier snapshots', () => {
  const storage = new MemoryStorage()
  const intro = createTutorialState('player-a')
  const access = { ...intro, step: 'round-1-access' as const }
  const power = { ...access, step: 'round-1-power' as const, budget: 3, accessSlot: 6, samples: ['boreal' as const] }
  saveTutorialSession(storage, power, { entry: power, history: [intro, access] })
  expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({
    state: power, timeline: { entry: power, history: [intro, access] },
  })
})

test('reloading the Thesis review retains the prepared answer without scoring it or changing Back', () => {
  const storage = new MemoryStorage()
  const stepTen = { ...createTutorialState('player-a'), step: 'round-1-thesis' as const }
  const review = {
    ...stepTen,
    step: 'round-1-thesis-review' as const,
    thesisDraft: { signalId: 'aster', fieldType: 'phase', polarity: 'positive' } as const,
  }
  const edited = { ...review, thesisDraft: { ...review.thesisDraft, polarity: '' as const } }
  saveTutorialSession(storage, edited, { entry: review, history: [stepTen] })
  expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({
    state: { ...edited, thesisAttempts: 0, privateTheses: [] },
    timeline: { entry: review, history: [stepTen] },
  })
})

test('reloading research closes the Journal and makes its previous entry current for Back', () => {
  const storage = new MemoryStorage()
  const intro = createTutorialState('player-a')
  const lab = { ...intro, step: 'round-1-lab-pair' as const }
  const research = { ...lab, step: 'research-results' as const }
  const open = { ...research, step: 'research-results-open' as const }
  const edited = { ...open, workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial' as const } } } } }
  saveTutorialSession(storage, edited, { entry: open, history: [lab, research] })

  expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({
    state: { ...edited, step: 'research-results' },
    timeline: { entry: research, history: [lab] },
  })
})

test('reloading interpretation closes the Journal without changing the tab Back will restore', () => {
  const storage = new MemoryStorage()
  const intro = createTutorialState('player-a')
  const research = { ...intro, step: 'research-results' as const }
  const openResearch = { ...research, step: 'research-results-open' as const }
  const openInterpretation = { ...openResearch, step: 'interpretation-open' as const }
  saveTutorialSession(storage, openInterpretation, { entry: openInterpretation, history: [research, openResearch] })

  expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({
    state: { ...openInterpretation, step: 'interpretation' },
    timeline: { entry: { ...openInterpretation, step: 'interpretation' }, history: [research, openResearch] },
  })
})

test('an invalid or excessive history is discarded independently of the current draft', () => {
  const storage = new MemoryStorage()
  const intro = createTutorialState('player-a')
  const access = { ...intro, step: 'round-1-access' as const }
  const key = 'anomaly-detector:tutorial:base:base-simple-v1:player-a'
  for (const history of [
    [{ ...intro, playerId: 'player-b' }],
    [{ ...intro, lessonId: 'additional' }],
    [access],
    [completed('player-a')],
    Array(100).fill(intro),
  ]) {
    storage.setItem(key, JSON.stringify({ schemaVersion: 2, state: access, timeline: { entry: access, history } }))
    expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({ state: access, timeline: null, notice: null })
  }
})

test('incomplete drafts from removed rounds restart with notice and cannot transfer', () => {
  const storage = new MemoryStorage()
  const intro = createTutorialState(guestTutorialPlayerId)
  const key = `anomaly-detector:tutorial:base:base-simple-v1:${guestTutorialPlayerId}`
  for (const draft of [
    { ...intro, round: 2, step: 'round-2-access' },
    { ...intro, round: 3, step: 'final-model', independentCycle: true },
  ]) {
    storage.setItem(key, JSON.stringify(draft))
    expect(loadTutorialSessionResult(storage, guestTutorialPlayerId)).toMatchObject({
      state: intro, timeline: null, notice: 'legacy-restart', completionCommand: null,
    })
    expect(beginGuestTutorialHandoff(storage)).toBe(false)
  }
})

test('a pre-envelope terminal draft transfers as the same credit and its stale bytes cannot be claimed again', () => {
  const storage = new MemoryStorage()
  const key = `anomaly-detector:tutorial:base:base-simple-v1:${guestTutorialPlayerId}`
  storage.setItem(key, JSON.stringify({ ...completed(), round: 3 }))
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  const claim = claimGuestTutorialHandoff(storage, 'player-a')!
  expect(claim.command).toEqual({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
  const removeItem = storage.removeItem.bind(storage)
  storage.removeItem = (candidate) => {
    if (candidate === key) throw new DOMException('blocked', 'SecurityError')
    removeItem(candidate)
  }
  finishGuestTutorialHandoff(storage, 'player-a', claim.handoffId)
  const reloaded = new MemoryStorage()
  for (const [name, value] of storage.values) reloaded.setItem(name, value)
  expect(reloaded.getItem(key)).not.toBeNull()
  expect(beginGuestTutorialHandoff(reloaded)).toBe(false)
  expect(claimGuestTutorialHandoff(reloaded, 'player-b')).toBeNull()
})

test('a new terminal draft stays readable by pre-envelope clients and drops undo snapshots', () => {
  const storage = new MemoryStorage()
  const state = completed()
  const intro = createTutorialState(guestTutorialPlayerId)
  saveTutorialSession(storage, state, { entry: state, history: [intro] })
  const key = `anomaly-detector:tutorial:base:base-simple-v1:${guestTutorialPlayerId}`
  expect(JSON.parse(storage.getItem(key)!)).toEqual(state)
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId).timeline).toBeNull()
})

test('unavailable tab storage keeps an in-memory base draft but never pretends a handoff persisted', () => {
  const storage = { getItem() { throw new DOMException('blocked', 'SecurityError') }, setItem() { throw new DOMException('blocked', 'SecurityError') }, removeItem() { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  const initial = loadTutorialSession(storage, guestTutorialPlayerId)
  expect(initial.step).toBe('prologue')
  const draft = { ...initial, step: 'round-1-access' as const }
  expect(saveTutorialSession(storage, draft)).toBe(false)
  expect(loadTutorialSession(storage, guestTutorialPlayerId)).toEqual(draft)
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId).notice).toBe('storage-unavailable')
  saveTutorialSession(storage, completed())
  expect(beginGuestTutorialHandoff(storage)).toBe(false)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)
  clearTutorialSession(storage, guestTutorialPlayerId)
  expect(loadTutorialSession(storage, guestTutorialPlayerId).step).toBe('prologue')
})

test('reading the sessionStorage property itself is optional', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } })
  try { expect(getTutorialStorage()).toBeUndefined() } finally { if (old) Object.defineProperty(globalThis, 'sessionStorage', old); else Reflect.deleteProperty(globalThis, 'sessionStorage') }
})

test('tutorial restores only the matching account and clears only the explicitly selected draft', () => {
  const storage = new MemoryStorage()
  const a = { ...createTutorialState('player-a'), step: 'round-1-power' as const }
  const b = { ...createTutorialState('player-b'), step: 'round-1-access' as const }
  saveTutorialSession(storage, a); saveTutorialSession(storage, b)
  expect(loadTutorialSession(storage, 'player-a')).toEqual(a)
  expect(loadTutorialSession(storage, 'player-b')).toEqual(b)
  clearTutorialSession(storage, 'player-a')
  expect(loadTutorialSession(storage, 'player-a')).toEqual(createTutorialState('player-a'))
  expect(loadTutorialSession(storage, 'player-b')).toEqual(b)
})

test('malformed, unknown-version and actor-mismatched drafts restart instead of reinterpreting steps', () => {
  for (const mutation of [(s: Record<string, unknown>) => { s.scenarioVersion = 'base-future' }, (s: Record<string, unknown>) => { s.playerId = 'another' }, (s: Record<string, unknown>) => { s.step = 'unknown' }, (s: Record<string, unknown>) => { s.lessonId = 'additional' }]) {
    const storage = new MemoryStorage(); saveTutorialSession(storage, { ...createTutorialState('player-a'), step: 'round-1-access' })
    const key = storage.key(0)!, data = JSON.parse(storage.getItem(key)!)
    mutation(data); storage.setItem(key, JSON.stringify(data))
    expect(loadTutorialSession(storage, 'player-a')).toEqual(createTutorialState('player-a'))
  }
})

test('an incomplete legacy named step explicitly restarts and cannot create credit', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify(legacy(guestTutorialPlayerId, 'round-1-power-intro')))
  const result = loadTutorialSessionResult(storage, guestTutorialPlayerId)
  expect(result.state).toEqual(createTutorialState(guestTutorialPlayerId))
  expect(result.notice).toBe('legacy-restart')
  expect(result.legacyCompleted).toBe(false)
  expect(beginGuestTutorialHandoff(storage)).toBe(false)
})

test('pre-envelope first-round drafts resume with a closed Journal and retain evidence', () => {
  for (const [open, entry] of [['research-results-open', 'research-results'], ['interpretation-open', 'interpretation']] as const) {
    const storage = new MemoryStorage()
    const state = { ...createTutorialState('player-a'), step: open, workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial' as const } } } } }
    storage.setItem('anomaly-detector:tutorial:base:base-simple-v1:player-a', JSON.stringify(state))
    expect(loadTutorialSessionResult(storage, 'player-a')).toMatchObject({ state: { ...state, step: entry }, timeline: null })
  }
})

test('a completed legacy guest transfers only truthful legacy-credit with first-account binding', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify(legacy()))
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId)).toMatchObject({ legacyCompleted: true, state: { step: 'prologue', independentCycle: false } })
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  const claim = claimGuestTutorialHandoff(storage, 'player-a')!
  expect(claim.command).toEqual({ kind: 'legacy-credit' })
  expect('completedAt' in claim.command).toBe(false)
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  finishGuestTutorialHandoff(storage, 'player-a', claim.handoffId)
  expect(loadTutorialSessionResult(storage, guestTutorialPlayerId).legacyCompleted).toBe(false)
})

test('an already claimed old handoff never changes its first account when upgraded', () => {
  const storage = new MemoryStorage()
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify(legacy()))
  storage.setItem('anomaly-detector:guest-tutorial-completion', JSON.stringify({ userId: 'player-a' }))
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-a')?.command).toEqual({ kind: 'legacy-credit' })
})

test('guest progress survives reload independently of an account draft and cannot transfer unfinished work', () => {
  const storage = new MemoryStorage()
  const account = { ...createTutorialState('player-a'), step: 'round-1-power' as const }
  const guest = { ...createTutorialState(guestTutorialPlayerId), step: 'research-results' as const }
  saveTutorialSession(storage, account); saveTutorialSession(storage, guest)
  expect(loadTutorialSession(storage, guestTutorialPlayerId)).toEqual(guest)
  expect(loadTutorialSession(storage, 'player-a')).toEqual(account)
  expect(beginGuestTutorialHandoff(storage)).toBe(false)
  clearTutorialSession(storage, guestTutorialPlayerId)
  expect(loadTutorialSession(storage, 'player-a')).toEqual(account)
})

test('only explicitly continued terminal base learning can be claimed; URL or a terminal name alone cannot', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, { ...createTutorialState(guestTutorialPlayerId), step: 'complete' })
  expect(beginGuestTutorialHandoff(storage)).toBe(false)
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)
  saveTutorialSession(storage, completed())
  expect(claimGuestTutorialCompletion(storage, 'player-a')).toBe(false)
  expect(beginGuestTutorialHandoff(storage)).toBe(true)
  expect(claimGuestTutorialHandoff(storage, 'player-a')?.command).toEqual({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
})

test('failed-save reload and retry retain first-account ownership until the matching successful consume', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, completed()); beginGuestTutorialHandoff(storage)
  const first = claimGuestTutorialHandoff(storage, 'player-a')!
  expect(claimGuestTutorialHandoff(storage, 'player-a')).toEqual(first)
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  finishGuestTutorialHandoff(storage, 'player-b', first.handoffId)
  finishGuestTutorialHandoff(storage, 'player-a', crypto.randomUUID())
  expect(claimGuestTutorialHandoff(storage, 'player-a')).toEqual(first)
  finishGuestTutorialHandoff(storage, 'player-a', first.handoffId)
  expect(claimGuestTutorialHandoff(storage, 'player-a')).toBeNull()
  expect(claimGuestTutorialHandoff(storage, 'player-b')).toBeNull()
  const reloaded = loadTutorialSessionResult(storage, 'player-a')
  expect(reloaded.completionCommand).toEqual({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
  expect(reloaded.state.workingModel).toEqual({ signals: {} })
  expect(reloaded.state.finalSubmission).toBeNull()
  prepareTutorialEntry(storage, 'player-a')
  expect(loadTutorialSessionResult(storage, 'player-a').completionCommand).toBeNull()
})

test('explicit menu entry repeats completed base and preserves another account or unfinished draft', () => {
  const storage = new MemoryStorage()
  const unfinished = { ...createTutorialState('player-b'), step: 'round-1-access' as const }
  saveTutorialSession(storage, completed('player-a')); saveTutorialSession(storage, unfinished)
  prepareTutorialEntry(storage, 'player-b')
  expect(loadTutorialSession(storage, 'player-b')).toEqual(unfinished)
  prepareTutorialEntry(storage, 'player-a')
  expect(loadTutorialSession(storage, 'player-a').step).toBe('prologue')
  expect(loadTutorialSession(storage, 'player-b')).toEqual(unfinished)
})

test('failed removal cannot resurrect an exited in-memory draft from read-only storage', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, completed())
  storage.removeItem = () => { throw new DOMException('blocked', 'SecurityError') }
  clearTutorialSession(storage, guestTutorialPlayerId)
  expect(loadTutorialSession(storage, guestTutorialPlayerId).step).toBe('prologue')
})

test('late legacy handoff preserves an actual completion receipt and the two origins remain distinct', () => {
  const storage = new MemoryStorage()
  saveTutorialSession(storage, completed())
  beginGuestTutorialHandoff(storage)
  const actual = claimGuestTutorialHandoff(storage, 'player-a')!
  finishGuestTutorialHandoff(storage, 'player-a', actual.handoffId)
  storage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify(legacy()))
  beginGuestTutorialHandoff(storage)
  const historical = claimGuestTutorialHandoff(storage, 'player-a')!
  expect(historical.command).toEqual({ kind: 'legacy-credit' })
  finishGuestTutorialHandoff(storage, 'player-a', historical.handoffId)
  expect(loadTutorialSessionResult(storage, 'player-a').completionCommand).toEqual(actual.command)
  expect(loadTutorialSessionResult(storage, 'player-b').completionCommand).toBeNull()
})
