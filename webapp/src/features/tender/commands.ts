import type { CommandReceipt, TenderCommand } from '@anomaly-detector/contracts'
import {
  commandReceiptSchema,
  tenderCommandSchema,
} from '@anomaly-detector/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'

type WithoutCommandEnvelope<T> = T extends unknown
  ? Omit<T, 'actorId' | 'commandId' | 'tenderId'>
  : never

export type TenderCommandInput = WithoutCommandEnvelope<TenderCommand>

export class TenderCommandOutcomeUnknownError extends Error {
  readonly cause: unknown
  readonly firstCause: unknown

  constructor(cause: unknown, firstCause: unknown = cause) {
    super('Tender command outcome requires authoritative reconciliation')
    this.name = 'TenderCommandOutcomeUnknownError'
    this.cause = cause
    this.firstCause = firstCause
  }
}

export class TenderCommandBusyError extends Error {
  constructor() {
    super('Another Tender command is still in flight')
    this.name = 'TenderCommandBusyError'
  }
}

type PendingCommand = {
  command: TenderCommandInput
  envelope: TenderCommand
  firstCause: unknown
}

type TenderCommandExecutorObserver = {
  onPendingUnknown?(error: unknown): void
  onRequestFinished?(): void
  onRequestStarted?(): void
  onResolved?(): void
}

export type TenderCommandPendingStore = {
  read(): TenderCommand | undefined
  write(command: TenderCommand | null): void
}

export type TenderCommandExecutor = ((command: TenderCommandInput) => Promise<CommandReceipt>) & {
  hasPending(): boolean
  outcomeUnknown(): boolean
  retryPending(): Promise<CommandReceipt | undefined>
  setTransport(transport: AuthenticatedTransport): void
}

type TenderCommandController = {
  execute(command: TenderCommandInput, transport: AuthenticatedTransport): Promise<CommandReceipt>
  hasPending(): boolean
  outcomeUnknown(): boolean
  retryPending(transport: AuthenticatedTransport): Promise<CommandReceipt | undefined>
}

type PendingUnknownState = {
  attempt: number
  error: unknown
  tenderId: string
}

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for HTTP origins where crypto.randomUUID is not available
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function shouldReconcileTenderCommandError(error: unknown) {
  if (error instanceof TenderCommandOutcomeUnknownError) return true
  if (error instanceof TenderCommandBusyError) return false
  if (!(error instanceof ApiRequestError)) return true
  return error.status >= 500 || error.code === 'INVALID_RESPONSE'
}

export function tenderCommandRetryDelayMs(attempt: number, error: unknown) {
  const exponentialDelayMs = Math.min(
    1_000 * (2 ** Math.min(Math.max(attempt - 1, 0), 5)),
    30_000,
  )
  const retryAfterMs = error instanceof ApiRequestError
    ? (error.retryAfterSeconds ?? 0) * 1_000
    : 0
  return Math.max(exponentialDelayMs, retryAfterMs)
}

export function createTenderCommandExecutor(
  transport: AuthenticatedTransport,
  tenderId: string,
  actorId: string,
  createCommandId: () => string = randomUUID,
  observer: TenderCommandExecutorObserver = {},
  pendingStore?: TenderCommandPendingStore,
): TenderCommandExecutor {
  const controller = createTenderCommandController(
    tenderId,
    actorId,
    createCommandId,
    observer,
    pendingStore,
  )
  let currentTransport = transport
  const execute = ((command: TenderCommandInput) => (
    controller.execute(command, currentTransport)
  )) as TenderCommandExecutor
  execute.hasPending = controller.hasPending
  execute.outcomeUnknown = controller.outcomeUnknown
  execute.retryPending = () => controller.retryPending(currentTransport)
  execute.setTransport = (nextTransport) => {
    currentTransport = nextTransport
  }
  return execute
}

function createTenderCommandController(
  tenderId: string,
  actorId: string,
  createCommandId: () => string,
  observer: TenderCommandExecutorObserver,
  pendingStore?: TenderCommandPendingStore,
): TenderCommandController {
  const storedEnvelope = pendingStore?.read()
  let pending: PendingCommand | null = storedEnvelope
    ? {
        command: commandInputFromEnvelope(storedEnvelope),
        envelope: storedEnvelope,
        firstCause: new Error('Tender command reconciliation resumed after navigation'),
    }
    : null
  let outcomeUnknown = storedEnvelope !== undefined

  const request = (transport: AuthenticatedTransport, envelope: TenderCommand) => transport.request(
    `/api/tenders/${tenderId}/commands`,
    commandReceiptSchema,
    { method: 'POST', body: envelope },
  )

  const writePending = (command: TenderCommand | null) => {
    try {
      pendingStore?.write(command)
    } catch {
      // Storage is best-effort; the in-memory controller still preserves the exact envelope.
    }
  }

  const resolvePending = () => {
    if (!pending) return
    pending = null
    outcomeUnknown = false
    writePending(null)
    observer.onResolved?.()
  }

  const markPending = (nextPending: PendingCommand, error: unknown) => {
    pending = nextPending
    outcomeUnknown = true
    writePending(nextPending.envelope)
    observer.onPendingUnknown?.(error)
  }

  const requestPending = async (
    nextPending: PendingCommand,
    outcomeWasUnknown: boolean,
    transport: AuthenticatedTransport,
  ) => {
    pending = nextPending
    writePending(nextPending.envelope)
    observer.onRequestStarted?.()
    try {
      const receipt = await request(transport, nextPending.envelope)
      resolvePending()
      return receipt
    } catch (error) {
      if (!outcomeWasUnknown && !shouldReconcileTenderCommandError(error)) {
        resolvePending()
        throw error
      }
      const markedPending = nextPending.firstCause === null
        ? { ...nextPending, firstCause: error }
        : nextPending
      markPending(markedPending, error)
      throw new TenderCommandOutcomeUnknownError(error, markedPending.firstCause)
    } finally {
      observer.onRequestFinished?.()
    }
  }

  return {
    execute(command, transport) {
      if (pending) {
        if (outcomeUnknown) {
          return Promise.reject(new TenderCommandOutcomeUnknownError(pending.firstCause))
        }
        return Promise.reject(new TenderCommandBusyError())
      }
      const envelope = tenderCommandSchema.parse({
        ...command,
        actorId,
        commandId: createCommandId(),
        tenderId,
      })
      return requestPending({ command, envelope, firstCause: null }, false, transport)
    },
    hasPending: () => pending !== null,
    outcomeUnknown: () => outcomeUnknown,
    retryPending: (transport) => pending
      ? requestPending(pending, true, transport)
      : Promise.resolve(undefined),
  }
}

export function useTenderCommands(
  transport: AuthenticatedTransport,
  tenderId: string,
  actorId: string,
) {
  const pendingKey = `${actorId}:${tenderId}`
  const [pendingUnknownByKey, setPendingUnknownByKey] = useState<
    Record<string, PendingUnknownState | null>
  >({})
  const [requestsInFlightByKey, setRequestsInFlightByKey] = useState<Record<string, number>>({})
  const pendingStore = useMemo(
    () => createSessionTenderCommandPendingStore(tenderId, actorId),
    [actorId, tenderId],
  )
  const controller = useMemo(
    () => createTenderCommandController(tenderId, actorId, randomUUID, {
      onRequestStarted: () => setRequestsInFlightByKey((current) => ({
        ...current,
        [pendingKey]: (current[pendingKey] ?? 0) + 1,
      })),
      onRequestFinished: () => setRequestsInFlightByKey((current) => ({
        ...current,
        [pendingKey]: Math.max((current[pendingKey] ?? 1) - 1, 0),
      })),
      onPendingUnknown: (error) => {
        setPendingUnknownByKey((current) => ({
          ...current,
          [pendingKey]: {
            attempt: current[pendingKey]?.attempt
              ? current[pendingKey].attempt + 1
              : 1,
            error,
            tenderId,
          },
        }))
      },
      onResolved: () => setPendingUnknownByKey((current) => ({
        ...current,
        [pendingKey]: null,
      })),
    }, pendingStore),
    [actorId, pendingKey, pendingStore, tenderId],
  )
  const restoredPending = useMemo<PendingUnknownState | null>(
    () => controller.hasPending()
      ? {
          attempt: 1,
          error: new Error('Tender command reconciliation resumed after navigation'),
          tenderId,
        }
      : null,
    [controller, tenderId],
  )
  const pendingUnknown = controller.hasPending()
    ? (pendingUnknownByKey[pendingKey] ?? restoredPending)
    : null
  const execute = useCallback((command: TenderCommandInput) => {
    return controller.execute(command, transport)
  }, [controller, transport])

  useEffect(() => {
    if (!pendingUnknown || pendingUnknown.tenderId !== tenderId) return
    const timer = globalThis.setTimeout(() => {
      void controller.retryPending(transport).catch(() => {
        // The executor retains the same envelope and schedules the next bounded retry.
      })
    }, tenderCommandRetryDelayMs(pendingUnknown.attempt, pendingUnknown.error))
    return () => globalThis.clearTimeout(timer)
  }, [controller, pendingUnknown, tenderId, transport])

  return {
    commandPending: (requestsInFlightByKey[pendingKey] ?? 0) > 0,
    execute,
    outcomeUnknown: controller.outcomeUnknown(),
  }
}

function commandInputFromEnvelope(envelope: TenderCommand): TenderCommandInput {
  return Object.fromEntries(
    Object.entries(envelope).filter(([key]) => (
      key !== 'actorId' && key !== 'commandId' && key !== 'tenderId'
    )),
  ) as TenderCommandInput
}

function createSessionTenderCommandPendingStore(
  tenderId: string,
  actorId: string,
): TenderCommandPendingStore | undefined {
  let storage: Storage
  try {
    storage = globalThis.sessionStorage
  } catch {
    return undefined
  }
  if (!storage) return undefined
  const key = `anomaly:tender-command:${actorId}:${tenderId}`
  return {
    read() {
      try {
        const serialized = storage.getItem(key)
        if (!serialized) return undefined
        const parsed = tenderCommandSchema.safeParse(JSON.parse(serialized))
        if (
          !parsed.success
          || parsed.data.actorId !== actorId
          || parsed.data.tenderId !== tenderId
        ) {
          storage.removeItem(key)
          return undefined
        }
        return parsed.data
      } catch {
        try {
          storage.removeItem(key)
        } catch {
          // Treat inaccessible storage as unavailable without exposing its contents.
        }
        return undefined
      }
    },
    write(command) {
      if (command) {
        storage.setItem(key, JSON.stringify(command))
      } else {
        storage.removeItem(key)
      }
    },
  }
}
