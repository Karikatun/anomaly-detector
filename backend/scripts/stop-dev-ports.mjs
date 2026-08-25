import { readlink, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)))
const apiPort = positivePort(Bun.env.PORT, 3000)
const workerPort = positivePort(Bun.env.WORKER_HEALTH_PORT, apiPort + 1)
const operationalMetricsPort = optionalPort(Bun.env.OPERATIONAL_METRICS_PORT)
const listeners = []

for (const port of new Set([
  apiPort,
  workerPort,
  ...(operationalMetricsPort === undefined ? [] : [operationalMetricsPort]),
])) {
  for (const pid of listenerPids(port)) listeners.push({ pid, port })
}

const processes = new Map()
for (const listener of listeners) {
  if (!processes.has(listener.pid)) {
    processes.set(listener.pid, await inspectProcess(listener.pid))
  }
}

const foreignListeners = listeners.filter(({ pid }) => !processes.get(pid)?.owned)
if (foreignListeners.length > 0) {
  for (const { pid, port } of foreignListeners) {
    console.error(`Refusing to stop process ${pid} on port ${port}: it does not belong to ${backendRoot}`)
  }
  process.exit(1)
}

for (const pid of processes.keys()) {
  await stopProcess(pid)
}
for (const { pid, port } of listeners) {
  console.log(`Stopped backend development process ${pid} on port ${port}`)
}

function positivePort(value, fallback) {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid development port: ${value}`)
  }
  return port
}

function optionalPort(value) {
  if (value === undefined || value === '') return undefined
  return positivePort(value, 0)
}

function listenerPids(port) {
  if (process.platform === 'win32') {
    const command = `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`
    return numericLines(run('powershell.exe', ['-NoProfile', '-Command', command]).stdout)
  }

  const result = run('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { allowFailure: true })
  return numericLines(result.stdout)
}

async function inspectProcess(pid) {
  if (process.platform === 'win32') {
    const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`
    const commandLine = run('powershell.exe', ['-NoProfile', '-Command', command], { allowFailure: true }).stdout.trim()
    const normalizedRoot = backendRoot.replaceAll('\\', '/').toLowerCase()
    const normalizedCommand = commandLine.replaceAll('\\', '/').toLowerCase()
    return {
      owned: normalizedCommand.includes(normalizedRoot)
        || /\bsrc\/(index|worker)\.ts\b/.test(normalizedCommand),
    }
  }

  const cwd = await processCwd(pid)
  return { owned: cwd !== null && isWithin(backendRoot, cwd) }
}

async function processCwd(pid) {
  if (process.platform === 'linux') {
    try {
      return await realpath(await readlink(`/proc/${pid}/cwd`))
    } catch {
      return null
    }
  }

  const result = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { allowFailure: true })
  const cwdLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('n'))
  if (!cwdLine) return null
  try {
    return await realpath(cwdLine.slice(1))
  } catch {
    return null
  }
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function stopProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error?.code === 'ESRCH') return
    throw error
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isRunning(pid)) return
    await Bun.sleep(25)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function numericLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function run(command, args, { allowFailure = false } = {}) {
  const result = Bun.spawnSync([command, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const stdout = new TextDecoder().decode(result.stdout)
  const stderr = new TextDecoder().decode(result.stderr)
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`${command} failed: ${stderr.trim() || `exit ${result.exitCode}`}`)
  }
  return { stdout }
}
