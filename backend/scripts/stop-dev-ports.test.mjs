import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const backendRoot = new URL('..', import.meta.url).pathname
const children = new Set()

afterEach(() => {
  for (const child of children) {
    try {
      child.kill('SIGKILL')
    } catch {
      // The preflight may already have stopped the child.
    }
  }
  children.clear()
})

describe('stop-dev-ports preflight', () => {
  test('stops backend-owned listeners on all configured development ports', async () => {
    const apiPort = 39_321
    const workerPort = 39_322
    const metricsPort = 39_323
    const api = startProcess(backendRoot)
    const worker = startProcess(backendRoot)
    const commandPath = await fakeLsof([
      { cwd: backendRoot, pid: api.pid, port: apiPort },
      { cwd: backendRoot, pid: api.pid, port: metricsPort },
      { cwd: backendRoot, pid: worker.pid, port: workerPort },
    ])

    const result = await runPreflight(apiPort, workerPort, commandPath, metricsPort)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Stopped backend development process ${api.pid} on port ${apiPort}`)
    expect(result.stdout).toContain(`Stopped backend development process ${api.pid} on port ${metricsPort}`)
    expect(result.stdout).toContain(`Stopped backend development process ${worker.pid} on port ${workerPort}`)
    await expect(api.exited).resolves.toBeDefined()
    await expect(worker.exited).resolves.toBeDefined()
  })

  test('refuses to stop a listener outside the backend workspace', async () => {
    const foreignPort = 39_323
    const foreignRoot = await mkdtemp(join(tmpdir(), 'anomaly-foreign-listener-'))
    const foreign = startProcess(foreignRoot)
    const commandPath = await fakeLsof([{ cwd: foreignRoot, pid: foreign.pid, port: foreignPort }])

    const result = await runPreflight(foreignPort, foreignPort + 1, commandPath, foreignPort + 2)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`Refusing to stop process ${foreign.pid} on port ${foreignPort}`)
    expect(isRunning(foreign.pid)).toBe(true)
  })
})

function startProcess(cwd) {
  const child = Bun.spawn(['sleep', '60'], { cwd })
  children.add(child)
  return child
}

async function fakeLsof(listeners) {
  const directory = await mkdtemp(join(tmpdir(), 'anomaly-fake-lsof-'))
  const cases = listeners.map(({ cwd, pid, port }) => `
if echo "$*" | grep -q -- "-tiTCP:${port}"; then echo "${pid}"; exit 0; fi
if echo "$*" | grep -q -- "-p ${pid}"; then printf 'p${pid}\\nfcwd\\nn${cwd}\\n'; exit 0; fi`).join('\n')
  const path = join(directory, 'lsof')
  await writeFile(path, `#!/bin/sh\n${cases}\nexit 0\n`)
  await chmod(path, 0o755)
  return directory
}

async function runPreflight(apiPort, workerPort, commandPath, metricsPort) {
  const preflight = Bun.spawn([process.execPath, 'scripts/stop-dev-ports.mjs'], {
    cwd: backendRoot,
    env: {
      ...Bun.env,
      PATH: `${commandPath}:${Bun.env.PATH}`,
      OPERATIONAL_METRICS_PORT: String(metricsPort),
      PORT: String(apiPort),
      WORKER_HEALTH_PORT: String(workerPort),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    preflight.exited,
    new Response(preflight.stderr).text(),
    new Response(preflight.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
