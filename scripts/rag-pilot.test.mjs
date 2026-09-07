import { describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { deriveStatus, evaluateBenchmark, isCorpusPath } from './rag-pilot.mjs'

const meta = { startedAt: '2026-09-07T12:00:00Z', deadline: '2026-09-14T12:00:00Z' }
const rootId = '01a07b95-0815-73d1-acea-5b79c1b7d2d0'
const childId = '01a07b95-0815-73d1-acea-5b79c1b7d2d1'
const digest = (s) => createHash('sha256').update(s).digest('hex')

function observationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'rag-observation-test-'))
  const pilot = join(root, '.scratch/rag-pilot')
  const codexHome = join(root, 'codex-home')
  const sessions = join(codexHome, 'sessions/2026/09/07')
  for (const path of [join(root, 'scripts'), pilot, sessions]) mkdirSync(path, { recursive: true })
  for (const name of ['rag-pilot.mjs', 'secret-check.mjs']) copyFileSync(join(import.meta.dir, name), join(root, 'scripts', name))
  writeFileSync(join(pilot, 'meta.json'), JSON.stringify({ ...meta, deadline: '2099-01-01T00:00:00Z', entries: {}, cases: [] }))
  writeFileSync(join(pilot, 'safety.json'), JSON.stringify({ safe: true }))
  const session = (id, source, extra = {}) => writeFileSync(join(sessions, `rollout-test-${id}.jsonl`),
    `${JSON.stringify({ type: 'session_meta', payload: { id, source, ...extra } })}\n`)
  session(rootId, 'vscode')
  const options = (id) => ({ encoding: 'utf8', timeout: 5000, env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: id } })
  const args = (...a) => [join(root, 'scripts/rag-pilot.mjs'), ...a]
  const call = (id, ...a) => spawnSync(process.execPath, args(...a), options(id))
  const concurrent = (id, ...a) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args(...a), options(id))
    let stdout = '', stderr = ''
    child.stdout.on('data', (data) => { stdout += data })
    child.stderr.on('data', (data) => { stderr += data })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
  const records = (dir) => existsSync(join(pilot, dir)) ? readdirSync(join(pilot, dir)) : []
  return { root, pilot, sessions, session, call, concurrent, records, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('bounded retrieval pilot', () => {
  test('only a verified top-level Codex task can search or observe; descendants and invented IDs consume no slots', () => {
    const f = observationFixture()
    try {
      for (const source of [{ subagent: { thread_spawn: { parent_thread_id: rootId, depth: 1 } } },
        { subagent: { thread_spawn: { parent_thread_id: 'intermediate-agent', depth: 3 } } }, 'unknown']) {
        f.session(childId, source)
        for (const command of [['identity'], ['batch'], ['search', childId, 'query'], ['search', rootId, 'query'], ['observe', childId, 'not-useful'], ['observe', rootId, 'not-useful']]) {
          expect(f.call(childId, ...command).status).toBe(1)
        }
      }
      expect(f.call(rootId, 'search', childId, 'query').status).toBe(1)
      expect(f.call('', 'search', rootId, 'query').status).toBe(1)
      f.session(rootId, 'vscode', { forked_from_id: childId })
      expect(f.call(rootId, 'search', rootId, 'query').status).toBe(1)
      expect(f.records('task-slots')).toHaveLength(0)
      expect(f.records('observations')).toHaveLength(0)
      f.session(rootId, 'vscode')
      expect(JSON.parse(f.call(rootId, 'identity').stdout).taskId).toBe(digest(rootId))
      expect(f.records('task-slots')).toHaveLength(0)
      expect(f.call(rootId, 'search', rootId, 'query').status).toBe(0)
      expect(f.call(rootId, 'observe', rootId, 'not-useful').status).toBe(0)
      expect(f.call(rootId, 'observe', rootId, 'not-useful').status).toBe(0)
      expect(f.records('task-slots')).toHaveLength(1)
      expect(f.records('observations')).toHaveLength(1)
    } finally { f.cleanup() }
  })
  test('five distinct top-level tasks retain separate observations and a sixth cannot exceed the quota', () => {
    const f = observationFixture()
    try {
      for (let n = 0; n < 6; n++) {
        const id = `${rootId.slice(0, -1)}${n}`
        f.session(id, 'vscode')
        expect(f.call(id, 'search', id, 'query').status).toBe(n < 5 ? 0 : 1)
        if (n < 5) expect(f.call(id, 'observe', id, 'not-useful').status).toBe(0)
      }
      expect(f.records('task-slots')).toHaveLength(5)
      expect(f.records('observations')).toHaveLength(5)
      expect(JSON.parse(f.call(rootId, 'status').stdout).phase).toBe('ACTIVE')
    } finally { f.cleanup() }
  })
  test('missing, ambiguous or malformed session metadata fails closed before reserving a slot', () => {
    const f = observationFixture()
    try {
      rmSync(join(f.sessions, `rollout-test-${rootId}.jsonl`))
      expect(f.call(rootId, 'search', rootId, 'query').status).toBe(1)
      f.session(rootId, 'vscode')
      writeFileSync(join(f.sessions, `duplicate-${rootId}.jsonl`), '{}\n')
      expect(f.call(rootId, 'search', rootId, 'query').status).toBe(1)
      rmSync(join(f.sessions, `duplicate-${rootId}.jsonl`))
      writeFileSync(join(f.sessions, `rollout-test-${rootId}.jsonl`), '{broken\n')
      expect(f.call(rootId, 'search', rootId, 'query').status).toBe(1)
      writeFileSync(join(f.sessions, `rollout-test-${rootId}.jsonl`), 'PRIVATE_FIXTURE_MARKER{invalid\n')
      expect(f.call(rootId, 'identity').stderr).not.toContain('PRIVATE_FIXTURE_MARKER')
      writeFileSync(join(f.sessions, `rollout-test-${rootId}.jsonl`), `${'x'.repeat(65536)}\n`)
      expect(f.call(rootId, 'identity').status).toBe(1)
      expect(f.records('task-slots')).toHaveLength(0)
    } finally { f.cleanup() }
  })
  test('concurrent searches and observations from one tree consume one slot and one immutable observation', async () => {
    const f = observationFixture()
    try {
      const searches = await Promise.all(Array.from({ length: 8 }, () => f.concurrent(rootId, 'search', rootId, 'query')))
      expect(searches.some((x) => x.status === 0)).toBe(true)
      for (const x of searches) if (x.status !== 0) expect(x.stderr).toContain('already reserved')
      expect(f.records('task-slots')).toHaveLength(1)
      expect(f.records('task-searches')).toHaveLength(1)
      const observations = await Promise.all(Array.from({ length: 8 }, () => f.concurrent(rootId, 'observe', rootId, 'not-useful')))
      expect(observations.every((x) => x.status === 0)).toBe(true)
      expect(f.records('observations')).toHaveLength(1)
      expect(f.call(rootId, 'observe', rootId, 'useful', 'docs/a.md').status).toBe(1)
      expect(JSON.parse(readFileSync(join(f.pilot, 'observations', `${digest(rootId)}.json`))).useful).toBe(false)
    } finally { f.cleanup() }
  })
  test('an interrupted search reservation cannot be retried with another query or allocate another slot', () => {
    const f = observationFixture()
    try {
      mkdirSync(join(f.pilot, 'task-claims', digest(rootId)), { recursive: true })
      expect(f.call(rootId, 'search', rootId, 'different query').stderr).toContain('already reserved')
      expect(f.records('task-slots')).toHaveLength(0)
    } finally { f.cleanup() }
  })
  test('CLI persists closure across fresh processes and init cannot restart an expired pilot', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'rag-pilot-test-'))
    try {
      mkdirSync(join(fixture, 'scripts'))
      mkdirSync(join(fixture, '.scratch/rag-pilot'), { recursive: true })
      for (const name of ['rag-pilot.mjs', 'secret-check.mjs']) copyFileSync(join(import.meta.dir, name), join(fixture, 'scripts', name))
      const savedMeta = { ...meta, startedAt: '2020-01-01T00:00:00Z', deadline: '2020-01-08T00:00:00Z', cases: [] }
      writeFileSync(join(fixture, '.scratch/rag-pilot/meta.json'), JSON.stringify(savedMeta))
      const call = (...args) => spawnSync(process.execPath, [join(fixture, 'scripts/rag-pilot.mjs'), ...args], { encoding: 'utf8', timeout: 5000 })
      const first = call('status')
      expect(first.status).toBe(0)
      expect(JSON.parse(first.stdout)).toMatchObject({ phase: 'CLOSED', verdict: 'INSUFFICIENT_DATA' })
      expect(existsSync(join(fixture, '.scratch/rag-pilot/closed.json'))).toBe(true)
      const search = call('search', 'new-conversation', 'where is auth')
      expect(search.status).toBe(1)
      expect(search.stderr).toContain('CLOSED')
      expect(call('init').status).toBe(0)
      expect(JSON.parse(readFileSync(join(fixture, '.scratch/rag-pilot/meta.json'), 'utf8'))).toEqual(savedMeta)
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  })
  test('deadline closes even when setup and all measurements are missing', () => {
    expect(deriveStatus(meta, [], [], null, new Date(meta.deadline))).toMatchObject({
      phase: 'CLOSED', verdict: 'INSUFFICIENT_DATA', reason: 'deadline',
    })
  })
  test('fresh conversations do not reset the deadline; safety failure stops immediately', () => {
    expect(deriveStatus(meta, [], [], null, new Date('2026-09-08'))).toMatchObject({ phase: 'SETUP' })
    expect(deriveStatus(meta, [], [], { safe: false }, new Date('2026-09-08'))).toMatchObject({
      phase: 'CLOSED', verdict: 'REJECT', reason: 'safety',
    })
  })
  test('no adoption from five observations without benchmark evidence', () => {
    const observations = Array.from({ length: 5 }, (_, i) => ({ taskId: `task-${i}`, useful: true }))
    expect(deriveStatus(meta, [], observations, { safe: true }, new Date('2026-09-08')).phase).toBe('ACTIVE')
  })
  test('the twentieth pair and fifth verified task close with a recommendation, never permanent enablement', () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, relevant: ['owner.ts'], language: i < 10 ? 'ru' : 'en' }))
    const results = cases.map(({ id }) => ({ id,
      baseline: { paths: ['unrelated.ts', 'owner.ts'], ms: 2, bytes: 100 },
      rag: { paths: ['owner.ts'], ms: 100, bytes: 100 },
    }))
    const observations = Array.from({ length: 5 }, (_, i) => ({ taskId: `task-${i}`, useful: true, verified: true }))
    expect(deriveStatus({ ...meta, cases }, results, observations, { safe: true }, new Date('2026-09-08')))
      .toMatchObject({ phase: 'CLOSED', verdict: 'ADOPT_CANDIDATE', reason: 'quota' })
    expect(deriveStatus({ ...meta, cases }, [...results.slice(0, 19), results[0]], observations, { safe: true }, new Date('2026-09-08')).phase).toBe('ACTIVE')
    const unverified = observations.map((x) => ({ ...x, verified: false }))
    expect(deriveStatus({ ...meta, cases }, results, unverified, { safe: true }, new Date('2026-09-08')).verdict).toBe('REJECT')
  })
  test('missing or timed out searches count as misses, not successful fast searches', () => {
    const cases = [{ id: 'one', relevant: ['a.ts'], language: 'ru' }, { id: 'two', relevant: ['b.ts'], language: 'en' }]
    const results = [{ id: 'one', baseline: { paths: ['a.ts'], ms: 1, bytes: 40 }, rag: { paths: ['a.ts'], ms: 8, bytes: 40 } },
      { id: 'two', baseline: { paths: ['b.ts'], ms: 1, bytes: 40 }, rag: { error: 'timeout', ms: 60000 } }]
    const report = evaluateBenchmark(cases, results)
    expect(report.rag.hit5).toBe(0.5)
    expect(report.rag.failures).toBe(1)
    expect(report.rag.p95Ms).toBe(60000)
    expect(report.rag.ruHit5).toBe(1)
    expect(report.rag.enHit5).toBe(0)
  })
  test('repeated chunks from one file cannot inflate rank or evidence completeness', () => {
    const report = evaluateBenchmark([{ id: 'x', relevant: ['a.ts', 'b.ts'], language: 'ru' }], [
      { id: 'x', baseline: { paths: [] }, rag: { paths: ['a.ts', 'a.ts', 'a.ts', 'a.ts', 'a.ts', 'b.ts'], ms: 1, bytes: 5 } },
    ])
    expect(report.rag.coverage5).toBe(1)
    expect(report.rag.mrr5).toBe(1)
  })
  test('corpus uses a narrow allowlist and excludes instructions, reports, runtime data and secrets', () => {
    for (const p of ['backend/src/modules/auth/index.ts', 'webapp/src/App.tsx', 'docs/adr/0003-tender-module-and-audit-log.md', 'CONTEXT.md', 'scripts/architecture-check.mjs']) expect(isCorpusPath(p)).toBe(true)
    for (const p of ['backend/.env', 'backend/.env.example', '.scratch/a.ts', 'docs/audits/a.md', 'docs/agents/rag-pilot.md', 'scripts/rag-pilot.mjs', 'posts/a.md', 'AGENTS.md', 'backend/src/generated/prisma/index.ts', '../other.ts', '/tmp/a.ts', 'backend/src/secrets.pem', 'backend/src/a.log']) expect(isCorpusPath(p)).toBe(false)
  })
})
