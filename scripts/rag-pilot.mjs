import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, lstatSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { secretContentKinds } from './secret-check.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pilot = join(root, '.scratch/rag-pilot')
const planPath = join(root, 'docs/agents/rag-pilot-cases.json')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
function create(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

export function isCorpusPath(path) {
  if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) return false
  if (/(^|\/)(\.env[^/]*|AGENTS\.md|generated|node_modules|dist|build|coverage)(\/|$)/.test(path)) return false
  if (/^docs\/(agents|audits|ui)\//.test(path) || /^scripts\/rag-pilot/.test(path)) return false
  if (!['.md', '.ts', '.tsx', '.mjs', '.js', '.astro', '.prisma', '.sql'].includes(extname(path))) return false
  return ['README.md', 'CONTEXT.md', 'SECURITY.md'].includes(path)
    || /^(docs\/|scripts\/|(?:backend|webapp|website|adminapp)\/src\/|backend\/prisma\/|packages\/[^/]+\/src\/)/.test(path)
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const percentile = (xs, q) => xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)] : null
export function evaluateBenchmark(cases, results) {
  const output = {}
  for (const arm of ['baseline', 'rag']) {
    const rows = cases.map((item) => {
      const result = results.find((r) => r.id === item.id)?.[arm]
      const paths = result?.error ? [] : [...new Set(result?.paths ?? [])].slice(0, 5)
      const rank = paths.findIndex((p) => item.relevant.includes(p))
      return { hit: rank < 0 ? 0 : 1, rr: rank < 0 ? 0 : 1 / (rank + 1),
        coverage: item.relevant.filter((p) => paths.includes(p)).length / item.relevant.length,
        language: item.language, failed: !result || !!result.error,
        ms: result?.ms ?? 60000, bytes: result?.bytes ?? 0 }
    })
    output[arm] = { hit5: mean(rows.map((r) => r.hit)), mrr5: mean(rows.map((r) => r.rr)),
      coverage5: mean(rows.map((r) => r.coverage)), failures: rows.filter((r) => r.failed).length,
      ruHit5: mean(rows.filter((r) => r.language === 'ru').map((r) => r.hit)),
      enHit5: mean(rows.filter((r) => r.language === 'en').map((r) => r.hit)),
      medianMs: percentile(rows.map((r) => r.ms), 0.5), p95Ms: percentile(rows.map((r) => r.ms), 0.95),
      totalBytes: rows.reduce((n, r) => n + r.bytes, 0) }
  }
  return output
}

export function deriveStatus(meta, results, observations, safety, now = new Date()) {
  if (safety?.safe === false) return { phase: 'CLOSED', verdict: 'REJECT', reason: 'safety' }
  const enough = results.length === 20 && new Set(results.map((x) => x.id)).size === 20
    && (!meta.cases || meta.cases.every((x) => results.some((r) => r.id === x.id)))
    && observations.length === 5 && new Set(observations.map((x) => x.taskId)).size === 5
  const expired = now.getTime() >= Date.parse(meta.deadline)
  if (!expired && !enough) return { phase: safety?.safe === true ? 'ACTIVE' : 'SETUP' }
  if (!enough || !safety?.safe || !meta.cases) return { phase: 'CLOSED', verdict: 'INSUFFICIENT_DATA', reason: expired ? 'deadline' : 'incomplete' }
  const metrics = evaluateBenchmark(meta.cases, results)
  const { rag: r, baseline: b } = metrics
  const better = r.hit5 >= b.hit5 + 0.1 - 1e-9 || (b.mrr5 > 0 && r.mrr5 >= b.mrr5 * 1.2)
  const pass = r.hit5 >= 0.8 && r.hit5 >= b.hit5 && r.coverage5 >= b.coverage5
    && r.ruHit5 >= 0.8 && r.enHit5 >= 0.8 && r.failures === 0 && r.p95Ms <= 5000
    && better && observations.filter((x) => x.useful && x.verified).length >= 3
  return { phase: 'CLOSED', verdict: pass ? 'ADOPT_CANDIDATE' : 'REJECT', reason: enough ? 'quota' : 'deadline', metrics }
}

function records(folder) {
  const path = join(pilot, folder)
  return existsSync(path) ? readdirSync(path).filter((x) => x.endsWith('.json')).sort().map((x) => json(join(path, x))) : []
}
function status() {
  const meta = json(join(pilot, 'meta.json'))
  const results = records('results')
  const observations = records('observations')
  const safety = existsSync(join(pilot, 'safety-failure.json')) ? { safe: false }
    : existsSync(join(pilot, 'safety.json')) ? json(join(pilot, 'safety.json')) : null
  const terminal = join(pilot, 'closed.json')
  const current = existsSync(terminal) ? json(terminal) : deriveStatus(meta, results, observations, safety)
  if (current.phase === 'CLOSED' && !existsSync(terminal)) {
    try { create(terminal, { ...current, closedAt: new Date().toISOString() }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  }
  return { ...current, startedAt: meta.startedAt, deadline: meta.deadline, benchmark: results.length,
    observations: observations.length, snapshot: meta.snapshot,
    metrics: results.length ? evaluateBenchmark(meta.cases, results) : null }
}
function requireActive() {
  const state = status()
  if (state.phase !== 'ACTIVE') throw new Error(`Pilot is ${state.phase}; retrieval is disabled`)
  return state
}

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000 })
  if (r.status !== 0) throw new Error('Git snapshot read failed')
  return r.stdout
}

function initialize() {
  if (existsSync(join(pilot, 'meta.json'))) return status()
  const cases = json(planPath)
  if (cases.length !== 20 || new Set(cases.map((x) => x.id)).size !== 20) throw new Error('Expected 20 distinct frozen cases')
  const snapshot = git(['rev-parse', 'HEAD']).trim()
  const paths = git(['ls-tree', '-r', '--name-only', snapshot]).trim().split('\n').filter(isCorpusPath)
  const entries = {}
  for (const path of paths) {
    if (!lstatSync(join(root, path)).isFile() || lstatSync(join(root, path)).isSymbolicLink()) continue
    const source = git(['show', `${snapshot}:${path}`])
    if (secretContentKinds(source).length) throw new Error(`Corpus rejected by secret check: ${path}`)
    if (Buffer.byteLength(source) > 1024 * 1024) throw new Error(`Corpus file exceeds limit: ${path}`)
    entries[path] = sha(source)
    const target = join(pilot, 'corpus', path)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) writeFileSync(target, source, { flag: 'wx', mode: 0o400 })
    if (sha(readFileSync(target)) !== entries[path]) throw new Error('Existing snapshot differs; no automatic reset')
  }
  for (const c of cases) for (const path of c.relevant) if (!entries[path]) throw new Error(`Unknown gold source: ${path}`)
  const now = new Date()
  create(join(pilot, 'meta.json'), { version: 1, snapshot, startedAt: now.toISOString(),
    deadline: new Date(now.getTime() + 7 * 86400000).toISOString(), cases, entries, planSha256: sha(readFileSync(planPath)) })
  return status()
}

function checkedRuntime() {
  const runtime = json(join(pilot, 'runtime.json'))
  if (!runtime.binary || !runtime.binarySha256 || sha(readFileSync(runtime.binary)) !== runtime.binarySha256) safetyFailure('Pinned binary digest mismatch')
  if (!realpathSync(runtime.binary).startsWith(`${realpathSync(join(pilot, 'runtime'))}/`)) safetyFailure('Binary outside pilot runtime')
  // A reviewed local-only sandbox is mandatory; never run a downloaded tool with ambient permissions.
  if (!runtime.sandbox || !runtime.sandboxSha256 || sha(readFileSync(runtime.sandbox)) !== runtime.sandboxSha256) safetyFailure('Reviewed sandbox missing')
  const config = join(pilot, 'corpus/.grepai/config.yaml')
  if (sha(readFileSync(config)) !== runtime.configSha256) safetyFailure('Reviewed configuration changed')
  return runtime
}

function safetyFailure(reason) {
  try { create(join(pilot, 'safety-failure.json'), { safe: false, reason, at: new Date().toISOString() }) }
  catch (e) { if (e.code !== 'EEXIST') throw e }
  status()
  throw new Error(reason)
}

function run(command, args, cwd, sandbox) {
  const start = performance.now()
  const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: join(pilot, 'runtime/home'),
    TMPDIR: join(pilot, 'runtime/tmp'), LANG: 'en_US.UTF-8', OLLAMA_HOST: '127.0.0.1:11434' }
  const result = spawnSync(sandbox ? '/usr/bin/sandbox-exec' : command,
    sandbox ? ['-f', sandbox, command, ...args] : args,
    { cwd, env, encoding: 'utf8', timeout: Math.max(1, Math.min(60000, Date.parse(json(join(pilot, 'meta.json')).deadline) - Date.now())), maxBuffer: 4 * 1024 * 1024 })
  return { ms: performance.now() - start, status: result.status, stdout: result.stdout ?? '', error: result.error?.code }
}

function baseline(item) {
  const r = run('/opt/homebrew/bin/rg', ['--json', '--sort', 'path', '-i', '-e', item.lexical, '.'], join(pilot, 'corpus'))
  if (r.status !== 0 && r.status !== 1) return { error: r.error ?? 'process-failed', ms: r.ms, bytes: 0, paths: [] }
  const counts = new Map()
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    if (entry.type !== 'match') continue
    const path = entry.data.path.text.replace(/^\.\//, '')
    if (isCorpusPath(path)) counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return { paths: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p).slice(0, 5), ms: r.ms, bytes: Buffer.byteLength(r.stdout) }
}

function semantic(query) {
  const runtime = checkedRuntime()
  const r = run(runtime.binary, ['search', query, '--json', '--limit', '30'], join(pilot, 'corpus'), runtime.sandbox)
  if (r.status !== 0) return { error: r.error ?? 'process-failed', ms: r.ms, bytes: 0, paths: [] }
  const data = JSON.parse(r.stdout)
  const rows = Array.isArray(data) ? data : data.results
  if (!Array.isArray(rows)) throw new Error('Unverified grepai result schema')
  const prefix = `${join(pilot, 'corpus')}/`
  const paths = rows.map((r) => (r.file_path ?? r.path ?? '').replace(prefix, '').replace(/^\.\//, ''))
  if (paths.some((p) => !isCorpusPath(p))) safetyFailure('Retrieval escaped approved corpus')
  return { paths: [...new Set(paths)].slice(0, 5), ms: r.ms, bytes: Buffer.byteLength(r.stdout) }
}

function batch() {
  requireActive()
  checkedRuntime()
  const meta = json(join(pilot, 'meta.json'))
  for (const [path, expected] of Object.entries(meta.entries)) if (sha(readFileSync(join(pilot, 'corpus', path))) !== expected) safetyFailure('Frozen corpus changed')
  // At most two cases per heartbeat. Exclusive claim files prevent duplicate runs across conversations.
  let count = 0
  for (const [index, item] of meta.cases.entries()) {
    requireActive()
    if (count === 2) break
    const claim = join(pilot, 'claims', `${item.id}.json`)
    try { create(claim, { id: item.id, startedAt: new Date().toISOString() }) } catch (e) { if (e.code === 'EEXIST') continue; throw e }
    count++
    const result = { id: item.id, startedAt: new Date().toISOString() }
    for (const arm of index % 2 === 0 ? ['baseline', 'rag'] : ['rag', 'baseline']) {
      try { requireActive(); result[arm] = arm === 'baseline' ? baseline(item) : semantic(item.query) }
      catch { result[arm] = { error: 'execution-or-validation-failed', paths: [], ms: 60000, bytes: 0 } }
    }
    create(join(pilot, 'results', `${item.id}.json`), { ...result, endedAt: new Date().toISOString() })
  }
  return status()
}

function searchTask(taskId, query) {
  requireActive()
  if (!taskId || !query || query.length > 1000 || secretContentKinds(query).length) throw new Error('Expected task id and short nonsecret query')
  const id = sha(taskId)
  const previous = records('task-searches').find((r) => r.taskId === id)
  if (previous) return previous
  const meta = json(join(pilot, 'meta.json'))
  for (let slot = 1; slot <= 5; slot++) {
    try { create(join(pilot, 'task-slots', `${slot}.json`), { taskId: id }) }
    catch (e) { if (e.code === 'EEXIST') continue; throw e }
    let retrieved
    try { retrieved = semantic(query) }
    catch { retrieved = { error: 'execution-or-validation-failed', paths: [], ms: 60000, bytes: 0 } }
    // Reject changed/deleted/symlinked results before exposing them. New files remain ordinary-search territory.
    const stalePaths = retrieved.paths.filter((path) => {
      const current = join(root, path)
      return !meta.entries[path] || !existsSync(current) || lstatSync(current).isSymbolicLink()
        || sha(readFileSync(current)) !== meta.entries[path]
    })
    const result = { taskId: id, at: new Date().toISOString(), querySha256: sha(query), ...retrieved,
      paths: retrieved.paths.filter((p) => !stalePaths.includes(p)), stalePaths,
      scope: 'frozen-snapshot; current-files-revalidated; new-files-require-ordinary-search' }
    create(join(pilot, 'task-searches', `${id}.json`), result)
    return result
  }
  throw new Error('Five task slots are already reserved; use ordinary search')
}

function observe(taskId, useful, path) {
  requireActive()
  const id = sha(taskId ?? '')
  const search = json(join(pilot, 'task-searches', `${id}.json`))
  if (!['useful', 'not-useful'].includes(useful)) throw new Error('Expected useful or not-useful')
  let verified = false
  if (useful === 'useful') {
    if (!search.paths.includes(path) || !isCorpusPath(path)) throw new Error('Useful evidence must reference a retrieved file')
    const expected = json(join(pilot, 'meta.json')).entries[path]
    verified = sha(readFileSync(join(root, path))) === expected
    if (!verified) throw new Error('Retrieved evidence is stale')
  }
  create(join(pilot, 'observations', `${id}.json`), { taskId: id, useful: useful === 'useful', verified, path: verified ? path : null, at: new Date().toISOString() })
  return status()
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2)
    const result = command === 'init' ? initialize() : command === 'status' || command === 'tick' ? status()
      : command === 'batch' ? batch() : command === 'search' ? searchTask(...args)
        : command === 'observe' ? observe(...args) : null
    if (!result) throw new Error('Use init | status | tick | batch | search <task-id> <query> | observe <task-id> useful <path> | observe <task-id> not-useful')
    console.log(JSON.stringify(result, null, 2))
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
