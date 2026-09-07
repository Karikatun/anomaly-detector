import { expect, test } from 'bun:test'

import { createOperationalMetrics } from './operational-metrics'
import { createWorkerHealth } from './worker-health'
import {
  createWorkerHttpFetch,
  dispatchMailProtectionAlerts,
  emitMailDeliveryProtectionAlert,
  recordMailProtectionTransitions,
  startPollingLoop,
} from './worker'

test('fails the dedicated alert cycle after the callback failure is durably recorded', async () => {
  await expect(dispatchMailProtectionAlerts({
    dispatcher: {
      dispatch: async () => ({ claimed: 1, delivered: 0, failed: 1, staleClaims: 0 }),
    },
    now: new Date('2026-09-04T10:00:00.000Z'),
    workerId: 'alert-worker-a',
  })).rejects.toThrow('Mail protection alert delivery failed')
})

test('keeps worker readiness healthy while retrying and terminal alerts stay observable', async () => {
  const health = createWorkerHealth()
  const metrics = createOperationalMetrics({
    mailProtectionAlertStateReader: {
      read: async () => ({
        leased: 0,
        nextAttemptAt: new Date('2026-09-04T10:00:30.000Z'),
        oldestPendingAt: new Date('2026-09-04T10:00:00.000Z'),
        pending: 2,
        retrying: 1,
        terminal: 1,
      }),
    },
    runtime: 'worker',
    workerHealth: health.snapshot,
  })
  const fetch = createWorkerHttpFetch({ health, operationalMetrics: metrics })
  const stop = startPollingLoop({
    health: health.registerLoop({
      intervalMs: 60_000,
      label: 'Mail protection alert delivery',
      metricKey: 'mail_protection_alert_delivery',
    }),
    intervalMs: 60_000,
    label: 'Mail protection alert delivery',
    task: () => dispatchMailProtectionAlerts({
      dispatcher: {
        dispatch: async () => ({ claimed: 0, delivered: 0, failed: 0, staleClaims: 0 }),
      },
      now: new Date('2026-09-04T10:00:00.000Z'),
      workerId: 'alert-worker-a',
    }),
  })

  await stop()

  expect((await fetch(new Request('http://worker/health/ready'))).status).toBe(200)
  const metricsBody = await (await fetch(new Request('http://worker/metrics'))).text()
  expect(metricsBody).toContain('anomaly_detector_mail_protection_alerts{state="retrying"} 1')
  expect(metricsBody).toContain('anomaly_detector_mail_protection_alerts{state="terminal"} 1')
})

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
