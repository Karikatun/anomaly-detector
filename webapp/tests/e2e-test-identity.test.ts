import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { nextE2eClientIp } from '../e2e/helpers/test'

const originalParallelIndex = process.env.TEST_PARALLEL_INDEX
const originalWorkerIndex = process.env.TEST_WORKER_INDEX
const webappRoot = resolve(import.meta.dir, '..')

afterEach(() => {
  restoreEnv('TEST_PARALLEL_INDEX', originalParallelIndex)
  restoreEnv('TEST_WORKER_INDEX', originalWorkerIndex)
})

test('allocates different synthetic client IP pools after a Playwright worker restart', () => {
  const firstWorkerIp = clientIpFromWorkerProcess({ parallelIndex: 0, workerIndex: 0 })
  const restartedWorkerIp = clientIpFromWorkerProcess({ parallelIndex: 0, workerIndex: 1 })

  expect(firstWorkerIp).toBe('198.18.0.1')
  expect(restartedWorkerIp).toBe('198.18.1.1')
})

test('keeps every worker pool inside the benchmark network with a unit-test fallback', () => {
  delete process.env.TEST_WORKER_INDEX
  delete process.env.TEST_PARALLEL_INDEX
  expect(nextE2eClientIp()).toBe('198.18.0.1')

  process.env.TEST_WORKER_INDEX = '1'
  expect(nextE2eClientIp()).toBe('198.18.1.1')

  process.env.TEST_WORKER_INDEX = '256'
  expect(nextE2eClientIp()).toBe('198.19.0.1')

  process.env.TEST_WORKER_INDEX = '511'
  expect(nextE2eClientIp()).toBe('198.19.255.1')
})

function clientIpFromWorkerProcess(input: { parallelIndex: number; workerIndex: number }) {
  const result = spawnSync(process.execPath, [
    '-e',
    "import { nextE2eClientIp } from './e2e/helpers/test.ts'; process.stdout.write(nextE2eClientIp())",
  ], {
    cwd: webappRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_PARALLEL_INDEX: String(input.parallelIndex),
      TEST_WORKER_INDEX: String(input.workerIndex),
    },
  })

  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return result.stdout
}

function restoreEnv(name: 'TEST_PARALLEL_INDEX' | 'TEST_WORKER_INDEX', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
