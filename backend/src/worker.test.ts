import { expect, test } from 'bun:test'

import { createOperationalMetrics } from './operational-metrics'
import { createWorkerHealth } from './worker-health'
import {
  createWorkerHttpFetch,
  emitMailDeliveryProtectionAlert,
  recordMailProtectionTransitions,
  startPollingLoop,
} from './worker'

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

test('serves worker heartbeat and mail protection metrics on the private health listener', async () => {
  let now = 1_000
  const health = createWorkerHealth({ now: () => now })
  const loop = health.registerLoop({
    intervalMs: 1_000,
    label: 'Tender advancement',
    metricKey: 'tender_advancement',
  })
  const metrics = createOperationalMetrics({
    now: () => now,
    runtime: 'worker',
    workerHealth: health.snapshot,
  })
  const fetch = createWorkerHttpFetch({ health, operationalMetrics: metrics })
  loop.started()
  now = 1_500
  loop.succeeded()
  recordMailProtectionTransitions({
    observe: metrics.observe,
    protectionAlerts: [{
      reason: 'delivery_budget_exhausted',
    }],
  })

  const metricsResponse = await fetch(new Request('http://worker/metrics'))
  const body = await metricsResponse.text()

  expect(metricsResponse.status).toBe(200)
  expect(body).toContain('anomaly_detector_worker_loop_last_success_unixtime_seconds{loop="tender_advancement"} 1.5')
  expect(body).toContain('anomaly_detector_worker_loop_stale{loop="tender_advancement"} 0')
  expect(body).toContain('anomaly_detector_mail_protection_transitions_total{reason="delivery_budget_exhausted"} 1')
  expect((await fetch(new Request('http://worker/health/live'))).status).toBe(200)
  expect((await fetch(new Request('http://worker/unknown'))).status).toBe(404)
})
