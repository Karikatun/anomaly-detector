import { expect, test } from 'bun:test'

import {
  createTenderCommandExecutor,
  shouldReconcileTenderCommandError,
  tenderCommandRetryDelayMs,
  TenderCommandBusyError,
  TenderCommandOutcomeUnknownError,
  type TenderCommandPendingStore,
} from '../src/features/tender/commands'
import { ApiRequestError, type AuthenticatedTransport, type HttpRequestOptions } from '../src/platform/api'

const actorId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const tenderId = '33333333-3333-4333-8333-333333333333'

test('identifies only ambiguous command responses for authoritative reconciliation', () => {
  expect(shouldReconcileTenderCommandError(new TypeError('Failed to fetch'))).toBe(true)
  expect(shouldReconcileTenderCommandError(
    new ApiRequestError(503, 'INTERNAL_ERROR', 'Unavailable'),
  )).toBe(true)
  expect(shouldReconcileTenderCommandError(
    new ApiRequestError(409, 'CONFLICT', 'Rejected before commit'),
  )).toBe(false)
})

test('retries an ambiguous command later with the same idempotency envelope', async () => {
  const submittedBodies: unknown[] = []
  const transport = {
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      if (submittedBodies.length === 1) throw new TypeError('Failed to fetch')
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(transport, tenderId, actorId, () => commandId)

  await expect(execute({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  expect(submittedBodies).toHaveLength(1)
  await expect(execute.retryPending()).resolves.toEqual({
    tenderId,
    version: 2,
  })
  expect(submittedBodies).toHaveLength(2)
  expect(submittedBodies[0]).toEqual(submittedBodies[1])
  expect(submittedBodies[0]).toMatchObject({ actorId, commandId, tenderId })
})

test('does not spin inside one ambiguous command request', async () => {
  let requests = 0
  const transport = {
    async request() {
      requests += 1
      throw new TypeError('Failed to fetch')
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(transport, tenderId, actorId, () => commandId)

  await expect(execute({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  expect(requests).toBe(1)
  expect(execute.hasPending()).toBeTrue()
  expect(execute.outcomeUnknown()).toBeTrue()
})

test('keeps the exact unknown envelope until a later receipt resolves it', async () => {
  const submittedBodies: unknown[] = []
  let commandIds = 0
  const transport = {
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      if (submittedBodies.length === 1) throw new TypeError('Failed to fetch')
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(
    transport,
    tenderId,
    actorId,
    () => `${commandId}-${++commandIds}`,
  )

  await expect(execute({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  await expect(execute.retryPending()).resolves.toEqual({ tenderId, version: 2 })

  expect(commandIds).toBe(1)
  expect(submittedBodies).toHaveLength(2)
  expect(submittedBodies[0]).toEqual(submittedBodies[1])
  expect(submittedBodies[0]).toMatchObject({
    commandId: `${commandId}-1`,
    slot: 1,
    type: 'request-access-slot',
  })
})

test('retains an unknown first outcome when the same-id retry is rate limited', async () => {
  let requests = 0
  const transport = {
    async request() {
      requests += 1
      if (requests === 1) throw new TypeError('Failed to fetch')
      throw new ApiRequestError(429, 'RATE_LIMITED', 'Try later')
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(transport, tenderId, actorId, () => commandId)

  await expect(execute({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  const reportedError = await execute.retryPending()
    .then(() => undefined, (error: unknown) => error)

  expect(requests).toBe(2)
  expect(shouldReconcileTenderCommandError(reportedError)).toBe(true)
})

test('does not replay a command after an authoritative conflict response', async () => {
  let requests = 0
  const conflict = new ApiRequestError(409, 'CONFLICT', 'Rejected before commit')
  const transport = {
    async request() {
      requests += 1
      throw conflict
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(transport, tenderId, actorId, () => commandId)

  await expect(execute({ type: 'request-access-slot', slot: 1 })).rejects.toBe(conflict)
  expect(requests).toBe(1)
  expect(execute.hasPending()).toBeFalse()
})

test('does not treat a conflict after an unknown response as proof that the first request cannot commit', async () => {
  const submittedBodies: unknown[] = []
  const transport = {
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      if (submittedBodies.length === 1) throw new TypeError('Failed to fetch')
      if (submittedBodies.length === 2) {
        throw new ApiRequestError(409, 'TENDER_VERSION_CONFLICT', 'Still racing')
      }
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport
  const execute = createTenderCommandExecutor(transport, tenderId, actorId, () => commandId)

  await expect(execute({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  await expect(execute.retryPending())
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  expect(execute.hasPending()).toBeTrue()
  await expect(execute.retryPending()).resolves.toEqual({ tenderId, version: 2 })

  expect(new Set(submittedBodies.map((body) => JSON.stringify(body))).size).toBe(1)
  expect(execute.hasPending()).toBeFalse()
})

test('restores an unknown envelope across executor and transport replacement', async () => {
  let storedCommand: ReturnType<TenderCommandPendingStore['read']>
  const store: TenderCommandPendingStore = {
    read: () => storedCommand,
    write: (command) => { storedCommand = command ?? undefined },
  }
  let commandIds = 0
  const firstExecutor = createTenderCommandExecutor({
    request: async () => { throw new TypeError('Failed to fetch') },
  } as AuthenticatedTransport, tenderId, actorId, () => `${commandId}-${++commandIds}`, {}, store)

  await expect(firstExecutor({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  expect(storedCommand).toMatchObject({ commandId: `${commandId}-1`, slot: 1 })

  const submittedBodies: unknown[] = []
  const replacementExecutor = createTenderCommandExecutor({
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport, tenderId, actorId, () => `${commandId}-${++commandIds}`, {}, store)
  await expect(replacementExecutor.retryPending()).resolves.toEqual({ tenderId, version: 2 })

  expect(commandIds).toBe(1)
  expect(submittedBodies[0]).toMatchObject({
    commandId: `${commandId}-1`,
    slot: 1,
    type: 'request-access-slot',
  })
  expect(storedCommand).toBeUndefined()
})

test('keeps one in-flight controller when authentication replaces its transport', async () => {
  const submittedBodies: unknown[] = []
  let rejectFirst!: (reason?: unknown) => void
  const firstResponse = new Promise<never>((_resolve, reject) => {
    rejectFirst = reject
  })
  let commandIds = 0
  const executor = createTenderCommandExecutor({
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      return firstResponse
    },
  } as AuthenticatedTransport, tenderId, actorId, () => `${commandId}-${++commandIds}`)

  const firstExecution = executor({ type: 'request-access-slot', slot: 1 })
  expect(executor.hasPending()).toBeTrue()
  expect(executor.outcomeUnknown()).toBeFalse()
  executor.setTransport({
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport)
  const definitiveConflict = new ApiRequestError(
    409,
    'TENDER_VERSION_CONFLICT',
    'Rejected before commit',
  )
  rejectFirst(definitiveConflict)

  await expect(firstExecution).rejects.toBe(definitiveConflict)
  expect(executor.hasPending()).toBeFalse()
  expect(executor.outcomeUnknown()).toBeFalse()
  await expect(executor({
    type: 'allocate-power',
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 1, reserve: 1 },
  })).resolves.toEqual({ tenderId, version: 2 })

  expect(commandIds).toBe(2)
  expect(submittedBodies).toHaveLength(2)
  expect(submittedBodies[0]).toMatchObject({ commandId: `${commandId}-1` })
  expect(submittedBodies[1]).toMatchObject({ commandId: `${commandId}-2` })
})

test('never resolves a new intent with the receipt of a fresh in-flight command', async () => {
  const submittedBodies: unknown[] = []
  const requestLifecycle: string[] = []
  let resolveWorkingModel!: (receipt: { tenderId: string; version: number }) => void
  const workingModelResponse = new Promise<{ tenderId: string; version: number }>((resolve) => {
    resolveWorkingModel = resolve
  })
  const executor = createTenderCommandExecutor({
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      return workingModelResponse
    },
  } as AuthenticatedTransport, tenderId, actorId, () => commandId, {
    onRequestFinished: () => requestLifecycle.push('finished'),
    onRequestStarted: () => requestLifecycle.push('started'),
  })

  const autosave = executor({ type: 'update-working-model', workingModel: { signals: {} } })
  expect(requestLifecycle).toEqual(['started'])
  await expect(executor({ type: 'forfeit-tender' })).rejects.toBeInstanceOf(TenderCommandBusyError)
  expect(submittedBodies).toHaveLength(1)
  expect(submittedBodies[0]).toMatchObject({ type: 'update-working-model' })

  resolveWorkingModel({ tenderId, version: 2 })
  await expect(autosave).resolves.toEqual({ tenderId, version: 2 })
  expect(requestLifecycle).toEqual(['started', 'finished'])
  expect(executor.hasPending()).toBeFalse()
})

test('falls back to in-memory reconciliation when session storage rejects writes', async () => {
  const submittedBodies: unknown[] = []
  const store: TenderCommandPendingStore = {
    read: () => undefined,
    write: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
  }
  const executor = createTenderCommandExecutor({
    async request(_path, _schema, options?: HttpRequestOptions) {
      submittedBodies.push(options?.body)
      if (submittedBodies.length === 1) throw new TypeError('Failed to fetch')
      return { tenderId, version: 2 }
    },
  } as AuthenticatedTransport, tenderId, actorId, () => commandId, {}, store)

  await expect(executor({ type: 'request-access-slot', slot: 1 }))
    .rejects.toBeInstanceOf(TenderCommandOutcomeUnknownError)
  await expect(executor.retryPending()).resolves.toEqual({ tenderId, version: 2 })

  expect(submittedBodies).toHaveLength(2)
  expect(submittedBodies[0]).toEqual(submittedBodies[1])
  expect(executor.hasPending()).toBeFalse()
})

test('uses Retry-After as the lower bound for the first reconciliation retry', () => {
  expect(tenderCommandRetryDelayMs(
    1,
    new ApiRequestError(503, 'INTERNAL_ERROR', 'Unavailable', 60),
  )).toBe(60_000)
  expect(tenderCommandRetryDelayMs(99, new TypeError('Failed to fetch'))).toBe(30_000)
})
