import { z } from 'zod'
import { getSessionStorage } from '@/platform/session-storage'
import { powerAllocationSchema, privateThesisSchema, scientificJournalEntrySchema, privateMeasurementSchema, scientificModelDraftSchema, scientificModelSchema, signalIdSchema, workingModelSchema, tutorialProgressCommandSchema, type TutorialProgressCommand } from '@anomaly-detector/contracts'
import { baseScenarioVersion, createTutorialState, resumeTutorialState, type TutorialState } from './scenario'

export const guestTutorialPlayerId = 'tutorial-guest'
const legacyAccountKey = 'anomaly-detector:tutorial-session'
const legacyGuestKey = 'anomaly-detector:guest-tutorial-session'
const legacyHandoffKey = 'anomaly-detector:guest-tutorial-completion'
const handoffKey = 'anomaly-detector:tutorial:base:handoff:v1'
const receiptSchema = z.object({ playerId: z.string().min(1).max(128), command: tutorialProgressCommandSchema }).strict()
function receiptKey(playerId: string) { return `anomaly-detector:tutorial:base:completion:${playerId}` }
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
const handoffSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenario-completed'), lessonId: z.literal('base'), scenarioVersion: z.literal(baseScenarioVersion), handoffId: z.string().uuid(), userId: z.string().min(1).max(128).nullable() }).strict(),
  z.object({ kind: z.literal('legacy-credit'), handoffId: z.string().uuid(), userId: z.string().min(1).max(128).nullable() }).strict(),
])
type Handoff = z.infer<typeof handoffSchema>
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
function sessionKey(playerId: string) { return `anomaly-detector:tutorial:base:${baseScenarioVersion}:${playerId}` }
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
function remove(storage: Storage | undefined, key: string) {
  memory(storage).set(key, '')
  try { storage?.removeItem(key) } catch { if (storage) failedStorage.add(storage) }
}
function decode<T>(serialized: string | null, schema: z.ZodType<T>): T | null {
  if (!serialized || serialized.length > 131_072) return null
  try { const parsed = schema.safeParse(JSON.parse(serialized)); return parsed.success ? parsed.data : null } catch { return null }
}
function oldKey(playerId: string) { return playerId === guestTutorialPlayerId ? legacyGuestKey : legacyAccountKey }
function legacyCompleted(storage: Storage | undefined, playerId: string) {
  const parsed = decode(read(storage, oldKey(playerId)), legacyStateSchema)
  return parsed?.playerId === playerId
}
export function loadTutorialSessionResult(storage: Storage | undefined, playerId: string): { state: TutorialState; notice: Notice; legacyCompleted: boolean; completionCommand: TutorialProgressCommand | null } {
  const raw = read(storage, sessionKey(playerId))
  const parsed = decode(raw, stateSchema)
  const state = parsed && (parsed.step !== 'complete' || (parsed.independentCycle && parsed.finalSubmission !== null)) ? resumeTutorialState(parsed) : null
  const legacy = legacyCompleted(storage, playerId)
  const unavailable = !storage || failedStorage.has(storage)
  const receipt = decode(read(storage, receiptKey(playerId)), receiptSchema)
  return {
    state: state?.playerId === playerId ? state : createTutorialState(playerId),
    legacyCompleted: legacy,
    completionCommand: state?.playerId === playerId && state.step === 'complete'
      ? { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion }
      : receipt?.playerId === playerId ? receipt.command : null,
    notice: unavailable ? 'storage-unavailable' : legacy ? 'legacy-complete' : !state && (raw || read(storage, oldKey(playerId))) ? 'legacy-restart' : null,
  }
}
export function loadTutorialSession(storage: Storage | undefined, playerId: string): TutorialState { return loadTutorialSessionResult(storage, playerId).state }
export function saveTutorialSession(storage: Storage | undefined, state: TutorialState): boolean {
  return write(storage, sessionKey(state.playerId), JSON.stringify(stateSchema.parse(state)))
}
export function clearTutorialSession(storage: Storage | undefined, playerId = '') {
  if (!playerId) {
    // Compatibility for the former account-only helper; remove only its decoded owner.
    const raw = decode(read(storage, legacyAccountKey), legacyStateSchema)
    if (raw) remove(storage, sessionKey(raw.playerId))
    remove(storage, legacyAccountKey)
    return
  }
  remove(storage, sessionKey(playerId))
  remove(storage, receiptKey(playerId))
  // The old account draft is shared by key, so never clear a different account's bytes.
  const old = read(storage, oldKey(playerId))
  if (old) { try { if (JSON.parse(old).playerId === playerId) remove(storage, oldKey(playerId)) } catch { /* Disposable draft. */ } }
  if (playerId === guestTutorialPlayerId) { remove(storage, handoffKey); remove(storage, legacyHandoffKey) }
}
export function prepareTutorialEntry(storage: Storage | undefined, playerId: string) {
  remove(storage, receiptKey(playerId))
  if (loadTutorialSession(storage, playerId).step === 'complete') remove(storage, sessionKey(playerId))
}
function readHandoff(storage: Storage | undefined): Handoff | null {
  const current = decode(read(storage, handoffKey), handoffSchema)
  if (current) return current
  const old = decode(read(storage, legacyHandoffKey), z.object({ userId: z.string().min(1).max(128).nullable() }).strict())
  if (!old || !legacyCompleted(storage, guestTutorialPlayerId)) return null
  return { kind: 'legacy-credit', handoffId: crypto.randomUUID(), userId: old.userId }
}
export function beginGuestTutorialHandoff(storage: Storage | undefined): boolean {
  if (!storage || failedStorage.has(storage)) return false
  const existing = readHandoff(storage)
  if (existing) return true
  const state = loadTutorialSession(storage, guestTutorialPlayerId)
  const scenarioComplete = state.step === 'complete' && state.independentCycle && state.finalSubmission !== null
  const legacy = legacyCompleted(storage, guestTutorialPlayerId)
  if (!scenarioComplete && !legacy) return false
  const marker: Handoff = scenarioComplete
    ? { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion, handoffId: crypto.randomUUID(), userId: null }
    : { kind: 'legacy-credit', handoffId: crypto.randomUUID(), userId: null }
  return write(storage, handoffKey, JSON.stringify(marker))
}
export function claimGuestTutorialHandoff(storage: Storage | undefined, userId: string): { command: TutorialProgressCommand; handoffId: string } | null {
  // A transfer requires durable tab storage. In-memory learning never pretends to survive auth.
  if (!storage || failedStorage.has(storage)) return null
  const handoff = readHandoff(storage)
  if (!handoff || (handoff.userId !== null && handoff.userId !== userId)) return null
  if (!write(storage, handoffKey, JSON.stringify({ ...handoff, userId }))) return null
  return { handoffId: handoff.handoffId, command: handoff.kind === 'legacy-credit' ? { kind: 'legacy-credit' } : { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion } }
}
export function claimGuestTutorialCompletion(storage: Storage | undefined, userId: string): boolean { return claimGuestTutorialHandoff(storage, userId) !== null }
export function finishGuestTutorialHandoff(storage: Storage | undefined, userId: string, handoffId?: string) {
  const marker = readHandoff(storage)
  if (marker?.userId !== userId || (handoffId !== undefined && marker.handoffId !== handoffId)) return
  const prior = decode(read(storage, receiptKey(userId)), receiptSchema)
  if (prior?.command.kind !== 'scenario-completed' || marker.kind === 'scenario-completed') {
    const command: TutorialProgressCommand = marker.kind === 'legacy-credit' ? { kind: 'legacy-credit' } : { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion }
    write(storage, receiptKey(userId), JSON.stringify({ playerId: userId, command }))
  }
  clearTutorialSession(storage, guestTutorialPlayerId)
}
