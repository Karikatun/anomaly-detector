import { describe, expect, test } from 'bun:test'

import { createWorkerHealth } from './worker-health'

describe('worker health', () => {
  test('is not ready until every polling loop has completed successfully', () => {
    let now = 1_000
    const health = createWorkerHealth({ now: () => now })
    const tender = health.registerLoop({ intervalMs: 2_000, label: 'Tender advancement' })
    const room = health.registerLoop({ intervalMs: 250, label: 'Room start' })

    expect(health.snapshot().ready).toBe(false)

    tender.started()
    tender.succeeded()
    expect(health.snapshot().ready).toBe(false)

    room.started()
    room.succeeded()
    expect(health.snapshot().ready).toBe(true)
  })

  test('becomes unavailable after a failure and recovers after the next success', () => {
    let now = 1_000
    const health = createWorkerHealth({ now: () => now })
    const loop = health.registerLoop({ intervalMs: 1_000, label: 'Tender advancement' })

    loop.started()
    loop.succeeded()
    expect(health.snapshot().ready).toBe(true)

    now = 1_500
    loop.started()
    loop.failed(new Error('database unavailable'))
    expect(health.snapshot()).toMatchObject({
      ready: false,
      loops: [
        {
          consecutiveFailures: 1,
          label: 'Tender advancement',
          lastError: 'database unavailable',
        },
      ],
    })

    now = 2_000
    loop.started()
    loop.succeeded()
    expect(health.snapshot()).toMatchObject({
      ready: true,
      loops: [
        {
          consecutiveFailures: 0,
          label: 'Tender advancement',
          lastError: null,
        },
      ],
    })
  })

  test('becomes unavailable when a loop heartbeat is stale', () => {
    let now = 1_000
    const health = createWorkerHealth({ now: () => now, staleMultiplier: 3 })
    const loop = health.registerLoop({ intervalMs: 1_000, label: 'Tender advancement' })

    loop.started()
    loop.succeeded()
    now = 6_001

    expect(health.snapshot()).toMatchObject({
      ready: false,
      loops: [{ stale: true }],
    })
  })

  test('serves liveness and readiness responses without exposing errors', async () => {
    const health = createWorkerHealth({ now: () => 1_000 })
    const loop = health.registerLoop({ intervalMs: 1_000, label: 'Tender advancement' })

    expect((await health.fetch(new Request('http://worker/health/live'))).status).toBe(200)
    expect((await health.fetch(new Request('http://worker/health/ready'))).status).toBe(503)

    loop.started()
    loop.failed(new Error('secret database detail'))
    const response = await health.fetch(new Request('http://worker/health/ready'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unavailable' })
    expect((await health.fetch(new Request('http://worker/unknown'))).status).toBe(404)
  })
})
