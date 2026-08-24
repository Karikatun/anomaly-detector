import { expect, test } from 'bun:test'

import { emitMailDeliveryProtectionAlert, startPollingLoop } from './worker'

test('worker polling starts immediately and shutdown waits for the active task', async () => {
  let releaseTask!: () => void
  const taskFinished = new Promise<void>((resolve) => {
    releaseTask = resolve
  })
  let starts = 0
  let successes = 0
  let stopped = false

  const stop = startPollingLoop({
    health: {
      failed: () => {
        throw new Error('unexpected failure')
      },
      started: () => {
        starts += 1
      },
      succeeded: () => {
        successes += 1
      },
    },
    intervalMs: 60_000,
    label: 'test',
    task: () => taskFinished,
  })

  await Promise.resolve()
  expect(starts).toBe(1)

  const stopPromise = stop().then(() => {
    stopped = true
  })
  await Promise.resolve()
  expect(stopped).toBe(false)

  releaseTask()
  await stopPromise

  expect(successes).toBe(1)
  expect(stopped).toBe(true)
})

test('mail protection alert output is allowlisted and exposes logger failure for durable retry', () => {
  const messages: string[] = []
  const unsafeInput = {
    occurredAt: new Date('2026-08-24T08:00:00.000Z'),
    payload: { token: 'must-not-leak' },
    reason: 'delivery_budget_exhausted' as const,
    recipient: 'private@example.test',
    transitionAt: new Date('2026-08-24T08:01:00.000Z'),
  }

  expect(() => emitMailDeliveryProtectionAlert(unsafeInput, {
    warn(message) {
      messages.push(message)
      throw new Error('logging unavailable')
    },
  })).toThrow('logging unavailable')
  expect(messages).toHaveLength(1)
  expect(JSON.parse(messages[0]!)).toEqual({
    channel: 'security',
    occurredAt: '2026-08-24T08:00:00.000Z',
    reason: 'delivery_budget_exhausted',
    transitionAt: '2026-08-24T08:01:00.000Z',
    type: 'mail_delivery_protection_activated',
  })
})
