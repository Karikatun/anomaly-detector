import { describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deriveStatus, evaluateBenchmark, isCorpusPath } from './rag-pilot.mjs'

const meta = { startedAt: '2026-09-07T12:00:00Z', deadline: '2026-09-14T12:00:00Z' }

describe('bounded retrieval pilot', () => {
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
