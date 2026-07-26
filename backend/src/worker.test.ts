import { expect, test } from 'bun:test'

import { startPollingLoop } from './worker'

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
