import { privateThesisSchema, workingModelSchema } from '@anomaly-detector/contracts'
import { z } from 'zod'

import {
  createTutorialState,
  type TutorialState,
} from './scenario'

const storageKey = 'anomaly-detector:tutorial-session'
const guestStorageKey = 'anomaly-detector:guest-tutorial-session'
const guestHandoffKey = 'anomaly-detector:guest-tutorial-completion'
export const guestTutorialPlayerId = 'tutorial-guest'

const guestHandoffSchema = z.object({ userId: z.string().min(1).max(128).nullable() }).strict()

function sessionKey(playerId: string) {
  return playerId === guestTutorialPlayerId ? guestStorageKey : storageKey
}

const tutorialStateSchema = z.object({
  budget: z.number().int(),
  corporateTrust: z.number().int().nonnegative(),
  hintLevel: z.number().int().nonnegative(),
  playerId: z.string().min(1),
  privateTheses: z.array(privateThesisSchema),
  rating: z.number().int().nonnegative(),
  round: z.union([z.literal(1), z.literal(2)]),
  step: z.enum([
    'prologue',
    'interaction-guide',
    'round-1-header',
    'round-1-sidebar',
    'round-1-contracts',
    'round-1-access-intro',
    'round-1-access',
    'round-1-power-intro',
    'round-1-power',
    'round-1-recon-intro',
    'round-1-recon',
    'round-1-lab-intro',
    'round-1-lab-mode',
    'round-1-lab-pair',
    'research-results',
    'research-results-open',
    'help-menu',
    'interpretation',
    'interpretation-open',
    'round-1-model-intro',
    'round-1-working-model',
    'round-1-thesis',
    'round-1-thesis-result',
    'round-1-thesis-result-open',
    'round-2-access',
    'round-2-contracts-review',
    'round-2-contracts-review-open',
    'round-2-power',
    'round-2-recon',
    'round-2-lab',
    'round-2-working-model',
    'round-2-thesis',
    'round-2-contracts-intro',
    'round-2-contract-reserve',
    'round-2-contract-bid',
    'final-model-intro',
    'final-model',
    'complete',
  ]),
  thesisAttempts: z.number().int().nonnegative(),
  workingModel: workingModelSchema,
}).strict()

export function loadTutorialSession(storage: Storage, playerId: string): TutorialState {
  const serialized = storage.getItem(sessionKey(playerId))
  if (!serialized) return createTutorialState(playerId)
  try {
    const parsed = tutorialStateSchema.safeParse(JSON.parse(serialized))
    if (parsed.success && parsed.data.playerId === playerId) return parsed.data
  } catch {
    // A broken tab-local draft is disposable; the tutorial safely restarts.
  }
  return createTutorialState(playerId)
}

export function saveTutorialSession(storage: Storage, state: TutorialState) {
  storage.setItem(sessionKey(state.playerId), JSON.stringify(tutorialStateSchema.parse(state)))
}

export function clearTutorialSession(storage: Storage, playerId = '') {
  storage.removeItem(sessionKey(playerId))
  if (playerId === guestTutorialPlayerId) storage.removeItem(guestHandoffKey)
}

export function prepareTutorialEntry(storage: Storage, playerId: string) {
  if (loadTutorialSession(storage, playerId).step === 'complete') {
    clearTutorialSession(storage, playerId)
  }
}

export function beginGuestTutorialHandoff(storage: Storage): boolean {
  if (loadTutorialSession(storage, guestTutorialPlayerId).step !== 'complete') return false
  storage.setItem(guestHandoffKey, JSON.stringify({ userId: null }))
  return true
}

export function claimGuestTutorialCompletion(storage: Storage, userId: string): boolean {
  if (loadTutorialSession(storage, guestTutorialPlayerId).step !== 'complete') return false
  const handoff = readGuestHandoff(storage)
  if (!handoff || (handoff.userId !== null && handoff.userId !== userId)) return false
  storage.setItem(guestHandoffKey, JSON.stringify({ userId }))
  return true
}

export function finishGuestTutorialHandoff(storage: Storage, userId: string) {
  if (readGuestHandoff(storage)?.userId !== userId) return
  clearTutorialSession(storage, guestTutorialPlayerId)
}

function readGuestHandoff(storage: Storage) {
  try {
    const parsed = guestHandoffSchema.safeParse(JSON.parse(storage.getItem(guestHandoffKey) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
