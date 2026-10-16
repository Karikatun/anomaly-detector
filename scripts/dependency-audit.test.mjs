import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { evaluateDependencyAudit, readProductionSources } from './dependency-audit.mjs'

const advisory = {
  id: 1240992,
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  title: 'braces stack exhaustion',
  severity: 'high',
  vulnerable_versions: '<=3.0.3',
  cwe: ['CWE-674'],
  cvss: { score: 7.5, vectorString: null },
}
const paths = [
  ['shadcn@4.7.0', 'fast-glob@3.3.3', 'micromatch@4.0.8', 'braces@3.0.3'],
  ['shadcn@4.7.0', 'ts-morph@26.0.0', '@ts-morph/common@0.27.0', 'fast-glob@3.3.3', 'micromatch@4.0.8', 'braces@3.0.3'],
]

function fixture() {
  return {
    audit: { status: 1, stdout: JSON.stringify({ braces: [advisory] }), stderr: 'bun audit v1.3.14 (d1632b29)\n' },
    policy: {
      exceptions: [{
        advisory: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', version: '3.0.3',
        owner: 'Karikatun', rationale: 'Retain the reviewed developer CLI until an upstream fix is available.',
        acceptedAt: '2026-10-16T00:00:00Z', expiresAt: '2026-10-30T23:59:59Z',
        workspace: 'webapp', dependencyType: 'devDependencies', paths: structuredClone(paths),
      }],
    },
    lock: {
      lockfileVersion: 1, configVersion: 1, overrides: {},
      workspaces: { '': {}, webapp: { devDependencies: { shadcn: '4.7.0' } }, backend: {} },
      packages: {
        shadcn: ['shadcn@4.7.0', '', { dependencies: { 'fast-glob': '^3.3.3', 'ts-morph': '^26.0.0' } }],
        'ts-morph': ['ts-morph@26.0.0', '', { dependencies: { '@ts-morph/common': '~0.27.0' } }],
        '@ts-morph/common': ['@ts-morph/common@0.27.0', '', { dependencies: { 'fast-glob': '^3.3.3' } }],
        'fast-glob': ['fast-glob@3.3.3', '', { dependencies: { micromatch: '^4.0.8' } }],
        micromatch: ['micromatch@4.0.8', '', { dependencies: { braces: '^3.0.3' } }],
        braces: ['braces@3.0.3', '', { dependencies: { 'fill-range': '^7.1.1' } }],
      },
    },
    manifests: { '': { overrides: {} }, webapp: { devDependencies: { shadcn: '4.7.0' } }, backend: {} },
    sources: [{ path: 'webapp/src/index.css', content: '@import "shadcn/tailwind.css";' }],
    now: new Date('2026-10-16T12:00:00Z'),
  }
}

test('allows exactly the reviewed advisory, version, CLI ancestry and CSS export', () => {
  expect(evaluateDependencyAudit(fixture())).toEqual({ advisories: 1, exceptions: 1 })
})

test('accepts a successful empty raw audit without manufacturing an exception match', () => {
  const input = fixture()
  input.audit = { status: 0, stdout: '{}', stderr: '' }
  expect(evaluateDependencyAudit(input)).toEqual({ advisories: 0, exceptions: 0 })
})

test('the durable exception matches the reviewed bounded policy', () => {
  const policy = JSON.parse(readFileSync(new URL('../.security/dependency-exceptions.json', import.meta.url), 'utf8'))
  expect(evaluateDependencyAudit({ ...fixture(), policy }).exceptions).toBe(1)
})

test('accepts the repository Bun workspace links and reads the real source scope', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  const input = fixture()
  input.lock = Bun.JSONC.parse(readFileSync(`${root}/bun.lock`, 'utf8'))
  input.manifests = Object.fromEntries(Object.keys(input.lock.workspaces).map((path) => [
    path, JSON.parse(readFileSync(`${root}/${path}/package.json`, 'utf8')),
  ]))
  input.sources = readProductionSources(root)
  expect(input.sources.length).toBeGreaterThan(0)
  expect(evaluateDependencyAudit(input).exceptions).toBe(1)
})

test('blocks every other advisory including another advisory on braces and low severity', () => {
  for (const extra of [
    { braces: [advisory, { ...advisory, id: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] },
    { braces: [advisory], other: [{ ...advisory, severity: 'low' }] },
  ]) {
    const input = fixture(); input.audit.stdout = JSON.stringify(extra)
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('blocks missing, malformed, broadened, future and expired exception records', () => {
  for (const mutate of [
    (f) => { f.policy = {} },
    (f) => { f.policy.exceptions = [] },
    (f) => { f.policy.exceptions.push(structuredClone(f.policy.exceptions[0])) },
    (f) => { f.policy.exceptions[0].unknown = true },
    (f) => { f.policy.exceptions[0].owner = '' },
    (f) => { f.policy.exceptions[0].rationale = '' },
    (f) => { f.policy.exceptions[0].version = '3.0.4' },
    (f) => { f.policy.exceptions[0].advisory = 'GHSA-aaaa-bbbb-cccc' },
    (f) => { f.policy.exceptions[0].expiresAt = '2026-11-01T00:00:00Z' },
    (f) => { f.policy.exceptions[0].expiresAt = 'invalid' },
    (f) => { f.policy.exceptions[0].paths = [paths[0]] },
    (f) => { f.now = new Date('2026-10-31T00:00:00Z') },
    (f) => { f.now = new Date('2026-10-30T23:59:59Z') },
    (f) => { f.now = new Date('2026-10-15T23:59:59Z') },
  ]) {
    const input = fixture(); mutate(input)
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('blocks version drift, aliases, duplicate instances and new graph ingress', () => {
  for (const mutate of [
    (f) => { f.lock.packages.braces[0] = 'braces@3.0.4' },
    (f) => { f.lock.packages['alias'] = ['braces@3.0.3', '', {}] },
    (f) => { f.lock.packages['other/braces'] = ['braces@3.0.3', '', {}] },
    (f) => { f.lock.packages.other = ['other@1.0.0', '', { dependencies: { braces: '^3.0.3' } }] },
    (f) => { f.lock.packages.other = ['other@1.0.0', '', { optionalDependencies: { micromatch: '^4.0.8' } }] },
    (f) => { f.lock.packages.other = ['other@1.0.0', '', { peerDependencies: { shadcn: '*' } }] },
    (f) => { f.lock.packages.shadcn[2].dependencies['fast-glob'] = '*' },
    (f) => { delete f.lock.packages['ts-morph'] },
    (f) => { f.lock.lockfileVersion = 2 },
    (f) => { f.lock.packages.alias = ['alias@workspace:unknown'] },
  ]) {
    const input = fixture(); mutate(input)
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('blocks production dependency reachability and unstored manifest changes', () => {
  for (const mutate of [
    (f) => { f.manifests.backend.dependencies = { braces: '3.0.3' } },
    (f) => { f.manifests.backend.dependencies = { shadcn: '4.7.0' }; f.lock.workspaces.backend.dependencies = { shadcn: '4.7.0' } },
    (f) => { f.manifests.webapp.dependencies = { shadcn: '4.7.0' }; f.lock.workspaces.webapp.dependencies = { shadcn: '4.7.0' } },
    (f) => { f.manifests.extra = { dependencies: { braces: '3.0.3' } } },
  ]) {
    const input = fixture(); mutate(input)
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('blocks literal source references to CLI packages while preserving only the CSS import', () => {
  for (const [path, content] of [
    ['backend/src/main.ts', 'import braces from "braces"'],
    ['webapp/src/main.ts', 'import("micromatch")'],
    ['website/src/page.astro', 'const x = require("fast-glob")'],
    ['packages/contracts/src/main.ts', 'export * from "@ts-morph/common"'],
    ['adminapp/src/main.ts', 'import "shadcn/tailwind.css"'],
    ['webapp/src/index.css', '@import "shadcn";'],
  ]) {
    const input = fixture(); input.sources.push({ path, content })
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('fails closed on audit transport, exit, warning, empty, malformed or unknown schema', () => {
  for (const audit of [
    { status: 1, stdout: '', stderr: 'ConnectionRefused: audit request failed' },
    { status: null, stdout: '{}', stderr: '', error: new Error('spawn failed') },
    { status: 2, stdout: '{}', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '[]', stderr: '' },
    { status: 1, stdout: '{', stderr: '' },
    { status: 1, stdout: '{"braces":[]}', stderr: '' },
    { status: 1, stdout: JSON.stringify({ braces: [{ ...advisory, new_schema: true }] }), stderr: '' },
    { status: 0, stdout: JSON.stringify({ braces: [advisory] }), stderr: '' },
    { status: 1, stdout: '{}', stderr: '' },
    { status: 1, stdout: JSON.stringify({ braces: [advisory] }), stderr: 'warning: partial audit' },
  ]) {
    expect(() => evaluateDependencyAudit({ ...fixture(), audit })).toThrow()
  }
})
