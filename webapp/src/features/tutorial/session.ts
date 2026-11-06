import { z } from 'zod'
import { getSessionStorage } from '@/platform/session-storage'
import { powerAllocationSchema, privateThesisSchema, scientificJournalEntrySchema, privateMeasurementSchema, scientificModelDraftSchema, scientificModelSchema, signalIdSchema, workingModelSchema, tutorialProgressCommandSchema, type TutorialLessonId, type TutorialProgressCommand } from '@anomaly-detector/contracts'
import { baseScenarioVersion, createTutorialState, resumeTutorialState, type TutorialState } from './scenario'
import { additionalScenarioVersion, createAdditionalTutorialState, type AdditionalTutorialState } from './additional-scenario'
import { additionalTutorialStateSchema, additionalTutorialStepSchema } from './additional-session-codec'

import { baseTutorialStepNumbers, isActiveBaseStep } from './base-steps'

type LessonState = TutorialState | AdditionalTutorialState
export type TutorialTimeline<T extends LessonState> = { entry: T; history: T[] }
export const tutorialHistoryLimit = 24
const sessionSizeLimit = 131_072
const draftEnvelopeSchema = z.object({ schemaVersion: z.literal(2), state: z.unknown(), timeline: z.unknown().optional() }).strict()
const timelineSchema = z.object({ entry: z.unknown(), history: z.array(z.unknown()).max(tutorialHistoryLimit) }).strict()

export const guestTutorialPlayerId = 'tutorial-guest'
const legacyAccountKey = 'anomaly-detector:tutorial-session'
const legacyGuestKey = 'anomaly-detector:guest-tutorial-session'
const legacyHandoffKey = 'anomaly-detector:guest-tutorial-completion'
const handoffKey = 'anomaly-detector:tutorial:base:handoff:v1'
const handoffEnvelopeKey = 'anomaly-detector:tutorial:handoffs:v1'
function lessonHandoffKey(lessonId: TutorialLessonId) { return lessonId === 'base' ? handoffKey : 'anomaly-detector:tutorial:additional:handoff:v1' }
const receiptSchema = z.object({ playerId: z.string().min(1).max(128), command: tutorialProgressCommandSchema }).strict()
function receiptKey(playerId: string, lessonId: TutorialLessonId = 'base') { return `anomaly-detector:tutorial:${lessonId}:completion:${playerId}` }
const steps = ['prologue', 'round-1-access', 'round-1-power', 'round-1-recon', 'round-1-lab-mode', 'round-1-lab-pair', 'research-results', 'research-results-open', 'interpretation', 'interpretation-open', 'round-1-working-model', 'round-1-thesis', 'round-1-thesis-result', 'round-2-access', 'round-2-power', 'round-2-lab', 'round-2-research', 'round-2-research-open', 'round-2-working-model', 'round-2-thesis', 'round-2-thesis-result', 'round-3-access', 'round-3-power', 'round-3-recon', 'round-3-lab', 'round-3-thesis', 'final-model', 'complete'] as const
const stateSchema = z.object({
  lessonId: z.literal('base'), scenarioVersion: z.literal(baseScenarioVersion), playerId: z.string().min(1).max(128),
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]), step: z.enum(steps),
  budget: z.number().int().min(0).max(100), corporateTrust: z.number().int().nonnegative(), rating: z.number().int().min(0).max(12),
  hintLevel: z.number().int().min(0).max(2), thesisAttempts: z.number().int().min(0).max(2),
  corporateReviewActive: z.boolean(), independentCycle: z.boolean(), accessSlot: z.number().int().min(1).max(6).nullable(), allocation: powerAllocationSchema.nullable(),
  samples: z.array(signalIdSchema).max(6), samplePool: z.array(signalIdSchema).max(6),
  journal: z.array(scientificJournalEntrySchema).max(6), privateMeasurements: z.array(privateMeasurementSchema).max(3), privateTheses: z.array(privateThesisSchema).max(6),
  workingModel: workingModelSchema, finalDraft: scientificModelDraftSchema.nullable(), finalSubmission: scientificModelSchema.nullable(),
}).strict()
const legacyStateSchema = z.object({
  budget: z.number().int(), corporateTrust: z.number().int().nonnegative(), hintLevel: z.number().int().nonnegative(),
  playerId: z.string().min(1).max(128), privateTheses: z.array(privateThesisSchema).max(100), rating: z.number().int().nonnegative(),
  round: z.union([z.literal(1), z.literal(2)]), step: z.literal('complete'), thesisAttempts: z.number().int().nonnegative(), workingModel: workingModelSchema,
}).strict()
const handoffSchema = z.union([
  z.object({ kind: z.literal('scenario-completed'), lessonId: z.literal('base'), scenarioVersion: z.literal(baseScenarioVersion), handoffId: z.string().uuid(), userId: z.string().min(1).max(128).nullable(), consumed: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('scenario-completed'), lessonId: z.literal('additional'), scenarioVersion: z.literal(additionalScenarioVersion), handoffId: z.string().uuid(), userId: z.string().min(1).max(128).nullable(), consumed: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('legacy-credit'), handoffId: z.string().uuid(), userId: z.string().min(1).max(128).nullable(), consumed: z.boolean().optional() }).strict(),
])
type Handoff = z.infer<typeof handoffSchema>
const handoffEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  base: handoffSchema.refine((marker) => marker.kind === 'legacy-credit' || marker.lessonId === 'base').nullable(),
  additional: handoffSchema.refine((marker) => marker.kind === 'scenario-completed' && marker.lessonId === 'additional').nullable(),
}).strict()
type HandoffEnvelope = z.infer<typeof handoffEnvelopeSchema>

type Notice = 'storage-unavailable' | 'legacy-restart' | 'legacy-complete' | null
const memoryByStorage = new WeakMap<Storage, Map<string, string>>()
const unavailableMemory = new Map<string, string>()
const failedStorage = new WeakSet<Storage>()
function memory(storage: Storage | undefined) {
  if (!storage) return unavailableMemory
  let values = memoryByStorage.get(storage)
  if (!values) { values = new Map(); memoryByStorage.set(storage, values) }
  return values
}
function sessionKey(playerId: string, lessonId: TutorialLessonId = 'base') { return `anomaly-detector:tutorial:${lessonId}:${lessonId === 'base' ? baseScenarioVersion : additionalScenarioVersion}:${playerId}` }
export const getTutorialStorage = getSessionStorage
function read(storage: Storage | undefined, key: string): string | null {
  if (!storage) return memory(storage).get(key) ?? null
  try {
    if (failedStorage.has(storage) && memory(storage).has(key)) return memory(storage).get(key)!
    return storage.getItem(key)
  } catch { failedStorage.add(storage); return memory(storage).get(key) ?? null }
}
function write(storage: Storage | undefined, key: string, value: string): boolean {
  memory(storage).set(key, value)
  try { if (!storage) return false; storage.setItem(key, value); return true } catch { if (storage) failedStorage.add(storage); return false }
}
function remove(storage: Storage | undefined, key: string): boolean {
  memory(storage).set(key, '')
  try { if (!storage) return false; storage.removeItem(key); return true } catch { if (storage) failedStorage.add(storage); return false }
}
function decode<T>(serialized: string | null, schema: z.ZodType<T>): T | null {
  if (!serialized || serialized.length > sessionSizeLimit) return null
  try { const parsed = schema.safeParse(JSON.parse(serialized)); return parsed.success ? parsed.data : null } catch { return null }
}
function oldKey(playerId: string) { return playerId === guestTutorialPlayerId ? legacyGuestKey : legacyAccountKey }
function removeOwnedLegacyDraft(storage: Storage | undefined, playerId: string): boolean {
  // Cleanup durability must use physical bytes, not the in-memory learning view:
  // a failed removal may already be shadowed there while the old completion remains.
  if (!storage) return false
  let raw: string | null
  try { raw = storage.getItem(oldKey(playerId)) } catch { failedStorage.add(storage); return false }
  if (!raw) return true
  try {
    if (JSON.parse(raw).playerId !== playerId) return true
  } catch { return true }
  return remove(storage, oldKey(playerId))
}
function legacyCompleted(storage: Storage | undefined, playerId: string) {
  const parsed = decode(read(storage, oldKey(playerId)), legacyStateSchema)
  return parsed?.playerId === playerId
}
function baseDraft(state: TutorialState) {
  return state.step === 'complete' ? state.independentCycle && state.finalSubmission !== null
    : state.round === 1 && isActiveBaseStep(state.step) && state.finalSubmission === null
      && (state.step !== 'final-model' || state.independentCycle)
}
function stepNumber(state: LessonState) {
  if (state.lessonId === 'additional') return additionalTutorialStepSchema.options.indexOf(state.step)
  return isActiveBaseStep(state.step) ? baseTutorialStepNumbers[state.step] : -1
}

function readDraft<T extends LessonState>(raw: string | null, schema: z.ZodType<T>, playerId: string, validState: (state: T) => boolean = () => true) {
  if (!raw || raw.length > sessionSizeLimit) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  const envelope = draftEnvelopeSchema.safeParse(value)
  const parseState = (input: unknown) => {
    const parsed = schema.safeParse(input)
    return parsed.success && parsed.data.playerId === playerId && validState(parsed.data) ? parsed.data : null
  }
  const state = parseState(envelope.success ? envelope.data.state : value)
  if (!state) return null
  if (!envelope.success || state.step === 'complete') return { state, timeline: null }

  // An invalid entry or snapshot invalidates only the undo branch, never the current draft.
  const timeline = timelineSchema.safeParse(envelope.data.timeline)
  if (timeline.success) {
    const entry = parseState(timeline.data.entry)
    const history: T[] = []
    let previousStep = -1
    for (const snapshot of timeline.data.history) {
      const prior = parseState(snapshot)
      if (!prior || prior.step === 'complete' || prior.finalSubmission !== null) break
      const number = stepNumber(prior)
      if (number <= previousStep || number >= stepNumber(state)) break
      history.push(prior)
      previousStep = number
    }
    if (entry?.step === state.step && entry.finalSubmission === null && history.length === timeline.data.history.length) {
      return { state, timeline: { entry, history } }
    }
  }
  return { state, timeline: null }
}

type LessonSessionResult<T extends LessonState> = {
  lessonId: T['lessonId']; state: T; timeline: TutorialTimeline<T> | null; notice: Notice; legacyCompleted: boolean; completionCommand: TutorialProgressCommand | null
}
type SelectedLessonSession = LessonSessionResult<TutorialState> | LessonSessionResult<AdditionalTutorialState>
export function loadTutorialSessionResult(storage: Storage | undefined, playerId: string, lessonId: 'additional'): LessonSessionResult<AdditionalTutorialState>
export function loadTutorialSessionResult(storage: Storage | undefined, playerId: string, lessonId?: 'base'): LessonSessionResult<TutorialState>
export function loadTutorialSessionResult(storage: Storage | undefined, playerId: string, lessonId: TutorialLessonId): SelectedLessonSession
export function loadTutorialSessionResult(storage: Storage | undefined, playerId: string, lessonId: TutorialLessonId = 'base'): SelectedLessonSession {
  const raw = read(storage, sessionKey(playerId, lessonId))
  if (lessonId === 'additional') {
    const parsed = readDraft(raw, additionalTutorialStateSchema, playerId)
    const receipt = decode(read(storage, receiptKey(playerId, lessonId)), receiptSchema)
    const state = parsed?.state ?? createAdditionalTutorialState(playerId)
    return {
      lessonId, state, timeline: parsed?.timeline ?? null, legacyCompleted: false,
      completionCommand: state.step === 'complete' ? { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: additionalScenarioVersion }
        : receipt?.playerId === playerId && receipt.command.kind === 'scenario-completed' && receipt.command.lessonId === 'additional' ? receipt.command : null,
      notice: !storage || failedStorage.has(storage) ? 'storage-unavailable' : !parsed && raw ? 'legacy-restart' : null,
    }
  }
  const parsed = readDraft(raw, stateSchema, playerId, baseDraft)
  const state = parsed ? resumeTutorialState(parsed.state) : createTutorialState(playerId)
  const savedTimeline = parsed?.timeline
  let timeline: TutorialTimeline<TutorialState> | null = null
  if (savedTimeline) {
    const previous = savedTimeline.history.at(-1)
    // A closed research Journal resumes at its entry. Its snapshot has
    // become current, so Back must skip it and reopening must not duplicate it.
    timeline = previous?.step === state.step
      ? { entry: previous, history: savedTimeline.history.slice(0, -1) }
      : { entry: resumeTutorialState(savedTimeline.entry), history: savedTimeline.history }
  }
  const legacy = legacyCompleted(storage, playerId)
  const receipt = decode(read(storage, receiptKey(playerId)), receiptSchema)
  return {
    lessonId, state, timeline,
    legacyCompleted: legacy,
    completionCommand: state.step === 'complete'
      ? { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion }
      : receipt?.playerId === playerId && (receipt.command.kind === 'legacy-credit' || receipt.command.lessonId === 'base') ? receipt.command : null,
    notice: !storage || failedStorage.has(storage) ? 'storage-unavailable' : legacy ? 'legacy-complete' : !parsed && (raw || read(storage, oldKey(playerId))) ? 'legacy-restart' : null,
  }
}
export function loadTutorialSession(storage: Storage | undefined, playerId: string): TutorialState { return loadTutorialSessionResult(storage, playerId).state }
export function saveTutorialSession<T extends LessonState>(storage: Storage | undefined, state: T, timeline?: TutorialTimeline<T>): boolean {
  const parsed = state.lessonId === 'base' ? stateSchema.parse(state) : additionalTutorialStateSchema.parse(state)
  // An earlier client must still recognize a terminal run for retry and for
  // durable handoff cleanup after a rollback. Only in-flight undo uses v2.
  let serialized = JSON.stringify(parsed)
  if (timeline && state.step !== 'complete') {
    const history = timeline.history.slice(-tutorialHistoryLimit)
    const envelope = { schemaVersion: 2, state: parsed, timeline: { entry: timeline.entry, history } }
    serialized = JSON.stringify(envelope)
    while (serialized.length > sessionSizeLimit && history.length) {
      history.shift()
      serialized = JSON.stringify(envelope)
    }
    if (serialized.length > sessionSizeLimit) serialized = JSON.stringify({ schemaVersion: 2, state: parsed })
  }
  const saved = write(storage, sessionKey(state.playerId, state.lessonId), serialized)
  // A durably saved fresh exercise supersedes a consumed old guest draft. A failed
  // reset/save keeps its tombstone, so stale terminal bytes cannot transfer again.
  if (saved && state.playerId === guestTutorialPlayerId && state.step !== 'complete') {
    const envelope = readHandoffs(storage)
    if (envelope?.[state.lessonId]?.consumed) clearGuestHandoff(storage, state.lessonId)
  }
  return saved
}
export function clearTutorialSession(storage: Storage | undefined, playerId = '', lessonId: TutorialLessonId = 'base') {
  if (!playerId) {
    // Compatibility for the former account-only helper; remove only its decoded owner.
    const raw = decode(read(storage, legacyAccountKey), legacyStateSchema)
    if (raw) remove(storage, sessionKey(raw.playerId))
    remove(storage, legacyAccountKey)
    return
  }
  remove(storage, sessionKey(playerId, lessonId))
  remove(storage, receiptKey(playerId, lessonId))
  if (lessonId === 'additional') {
    if (playerId === guestTutorialPlayerId) clearGuestHandoff(storage, lessonId)
    return
  }
  // Every completed origin must be durably discarded before resetting ownership.
  // The shared old account key still preserves a different account's bytes.
  removeOwnedLegacyDraft(storage, playerId)
  if (playerId === guestTutorialPlayerId) clearGuestHandoff(storage, 'base')
}
export function prepareTutorialEntry(storage: Storage | undefined, playerId: string, lessonId: TutorialLessonId = 'base') {
  remove(storage, receiptKey(playerId, lessonId))
  if (loadTutorialSessionResult(storage, playerId, lessonId).state.step === 'complete') remove(storage, sessionKey(playerId, lessonId))
}
function readLegacyHandoff(storage: Storage | undefined, lessonId: TutorialLessonId): Handoff | null {
  const current = decode(read(storage, lessonHandoffKey(lessonId)), handoffSchema)
  if (current && (current.kind === 'legacy-credit' ? lessonId === 'base' : current.lessonId === lessonId)) return current
  if (lessonId === 'additional') return null
  const old = decode(read(storage, legacyHandoffKey), z.object({ userId: z.string().min(1).max(128).nullable() }).strict())
  if (!old || !legacyCompleted(storage, guestTutorialPlayerId)) return null
  return { kind: 'legacy-credit', handoffId: crypto.randomUUID(), userId: old.userId }
}
function readHandoffs(storage: Storage | undefined): HandoffEnvelope | null {
  const raw = read(storage, handoffEnvelopeKey)
  // A present envelope, including selected-entry tombstones, supersedes legacy keys.
  // Invalid future/corrupt bytes never revive an older unowned transfer.
  if (raw !== null) return decode(raw, handoffEnvelopeSchema)
  return handoffEnvelopeSchema.parse({ schemaVersion: 1, base: readLegacyHandoff(storage, 'base'), additional: readLegacyHandoff(storage, 'additional') })
}
function readHandoff(storage: Storage | undefined, lessonId: TutorialLessonId): Handoff | null {
  const marker = readHandoffs(storage)?.[lessonId]
  return marker && !marker.consumed ? marker : null
}
function durableGuestCompletionRemains(storage: Storage | undefined, lessonId: TutorialLessonId): boolean | null {
  if (!storage) return null
  let modern: string | null, legacy: string | null
  try {
    modern = storage.getItem(sessionKey(guestTutorialPlayerId, lessonId))
    legacy = lessonId === 'base' ? storage.getItem(legacyGuestKey) : null
  } catch { failedStorage.add(storage); return null }
  if (lessonId === 'additional') {
    return readDraft(modern, additionalTutorialStateSchema, guestTutorialPlayerId)?.state.step === 'complete'
  }
  const draft = readDraft(modern, stateSchema, guestTutorialPlayerId, baseDraft)
  const old = decode(legacy, legacyStateSchema)
  return Boolean(draft?.state.step === 'complete'
    || old?.playerId === guestTutorialPlayerId)
}
function clearGuestHandoff(storage: Storage | undefined, lessonId: TutorialLessonId) {
  const envelope = readHandoffs(storage)
  if (!envelope) return
  // This is the sole ownership-reset decision for explicit reset and fresh save.
  // Physical completed origins, or an unreadable origin, cannot be erased by the
  // in-memory learning view. Finish only consumes; it never clears ownership.
  const completionRemains = durableGuestCompletionRemains(storage, lessonId)
  if (completionRemains === null) return
  const marker = envelope[lessonId]
  const next = completionRemains && marker ? { ...marker, consumed: true } : null
  write(storage, handoffEnvelopeKey, JSON.stringify({ ...envelope, [lessonId]: next }))
  remove(storage, lessonHandoffKey(lessonId))
  if (lessonId === 'base') remove(storage, legacyHandoffKey)
}
function completedGuestHandoff(storage: Storage | undefined, lessonId: TutorialLessonId): Handoff | null {
  const loaded = loadTutorialSessionResult(storage, guestTutorialPlayerId, lessonId)
  const scenarioComplete = loaded.state.step === 'complete' && loaded.completionCommand?.kind === 'scenario-completed'
  if (scenarioComplete) return lessonId === 'base'
    ? { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion, handoffId: crypto.randomUUID(), userId: null }
    : { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: additionalScenarioVersion, handoffId: crypto.randomUUID(), userId: null }
  return lessonId === 'base' && loaded.legacyCompleted
    ? { kind: 'legacy-credit', handoffId: crypto.randomUUID(), userId: null } : null
}
export function beginGuestTutorialHandoff(storage: Storage | undefined, lessonId: TutorialLessonId = 'base'): boolean {
  if (!storage || failedStorage.has(storage)) return false
  const envelope = readHandoffs(storage)
  if (!envelope) return false
  const existing = envelope[lessonId]
  if (existing) {
    if (!existing.consumed) return true
    // A later historical origin may still be credited to the already bound actor.
    // It never turns a consumed current run into another account's new transfer.
    if (lessonId !== 'base' || existing.kind !== 'scenario-completed' || !legacyCompleted(storage, guestTutorialPlayerId)) return false
    const historical: Handoff = { kind: 'legacy-credit', handoffId: crypto.randomUUID(), userId: existing.userId }
    return write(storage, handoffEnvelopeKey, JSON.stringify({ ...envelope, base: historical }))
  }
  const marker = completedGuestHandoff(storage, lessonId)
  return marker !== null && !failedStorage.has(storage)
    && write(storage, handoffEnvelopeKey, JSON.stringify({ ...envelope, [lessonId]: marker }))
}
function handoffCommand(marker: Handoff): TutorialProgressCommand {
  return marker.kind === 'legacy-credit' ? { kind: 'legacy-credit' } : marker.lessonId === 'base'
    ? { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion }
    : { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: additionalScenarioVersion }
}
export function claimGuestTutorialHandoff(storage: Storage | undefined, userId: string, lessonId: TutorialLessonId = 'base'): { command: TutorialProgressCommand; handoffId: string } | null {
  // One durable write binds every waiting completed run. No selected command is
  // returned before this succeeds, so a sibling quota failure cannot split actors.
  if (!storage || failedStorage.has(storage)) return null
  const envelope = readHandoffs(storage)
  if (!envelope) return null
  const selected = envelope[lessonId]
  if (!selected || selected.consumed || (selected.userId !== null && selected.userId !== userId)) return null
  const otherLesson = lessonId === 'base' ? 'additional' : 'base'
  const sibling = envelope[otherLesson] ?? completedGuestHandoff(storage, otherLesson)
  const claimed: HandoffEnvelope = {
    ...envelope,
    [lessonId]: { ...selected, userId },
    [otherLesson]: sibling?.userId === null && !sibling.consumed ? { ...sibling, userId } : sibling,
  }
  if (failedStorage.has(storage) || !write(storage, handoffEnvelopeKey, JSON.stringify(claimed))) return null
  return { handoffId: selected.handoffId, command: handoffCommand(selected) }
}
export function claimGuestTutorialCompletion(storage: Storage | undefined, userId: string): boolean { return claimGuestTutorialHandoff(storage, userId) !== null }
export function finishGuestTutorialHandoff(storage: Storage | undefined, userId: string, handoffId?: string, lessonId: TutorialLessonId = 'base') {
  const marker = readHandoff(storage, lessonId)
  if (marker?.userId !== userId || (handoffId !== undefined && marker.handoffId !== handoffId)) return
  const prior = decode(read(storage, receiptKey(userId, lessonId)), receiptSchema)
  if (prior?.command.kind !== 'scenario-completed' || marker.kind === 'scenario-completed') {
    write(storage, receiptKey(userId, lessonId), JSON.stringify({ playerId: userId, command: handoffCommand(marker) }))
  }
  const envelope = readHandoffs(storage)
  if (!envelope || !write(storage, handoffEnvelopeKey, JSON.stringify({ ...envelope, [lessonId]: { ...marker, consumed: true } }))) return
  // The ownership/consumption fact is durable before any fallible cleanup.
  remove(storage, sessionKey(guestTutorialPlayerId, lessonId))
  remove(storage, receiptKey(guestTutorialPlayerId, lessonId))
  remove(storage, lessonHandoffKey(lessonId))
  if (lessonId === 'base') { remove(storage, legacyGuestKey); remove(storage, legacyHandoffKey) }
}
