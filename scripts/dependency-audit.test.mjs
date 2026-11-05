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
const retiredException = {
  advisory: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', version: '3.0.3',
  owner: 'Karikatun', rationale: 'Historical CLI exception.',
  acceptedAt: '2026-10-16T00:00:00Z', expiresAt: '2026-10-30T23:59:59Z',
  workspace: 'webapp', dependencyType: 'devDependencies',
  paths: [
    ['shadcn@4.7.0', 'fast-glob@3.3.3', 'micromatch@4.0.8', 'braces@3.0.3'],
    ['shadcn@4.7.0', 'ts-morph@26.0.0', '@ts-morph/common@0.27.0', 'fast-glob@3.3.3', 'micromatch@4.0.8', 'braces@3.0.3'],
  ],
}

function fixture() {
  return {
    audit: { status: 0, stdout: '{}', stderr: 'bun audit v1.3.14 (d1632b29)\n' },
    policy: { exceptions: [] },
    lock: {
      lockfileVersion: 1, configVersion: 1, overrides: {},
      workspaces: { '': {}, webapp: { devDependencies: { 'fast-glob': '^3.3.3' } }, backend: {} },
      packages: {
        'fast-glob': ['fast-glob@3.3.3', '', { dependencies: { micromatch: '^4.0.8' } }],
        micromatch: ['micromatch@4.0.8', '', { dependencies: { braces: '^3.0.3' } }],
        braces: ['braces@3.0.3', '', { dependencies: { 'fill-range': '^7.1.1' } }],
      },
    },
    manifests: { '': { overrides: {} }, webapp: { devDependencies: { 'fast-glob': '^3.3.3' } }, backend: {} },
    sources: [{ path: 'webapp/src/index.css', content: '@import "./styles/vendor/shadcn-tailwind-4.7.0.css";' }],
  }
}

test('accepts a clean raw audit without the retired CLI under the zero-exceptions policy', () => {
  const policy = JSON.parse(readFileSync(new URL('../.security/dependency-exceptions.json', import.meta.url), 'utf8'))
  expect(evaluateDependencyAudit({ ...fixture(), policy })).toEqual({ advisories: 0, exceptions: 0 })
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
  expect(evaluateDependencyAudit(input)).toEqual({ advisories: 0, exceptions: 0 })
})

test('blocks every advisory including the former braces ID and unrelated low severity findings', () => {
  for (const findings of [
    { braces: [advisory] },
    { braces: [{ ...advisory, id: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] },
    { other: [{ ...advisory, severity: 'low' }] },
  ]) {
    const audit = { status: 1, stdout: JSON.stringify(findings), stderr: '' }
    expect(() => evaluateDependencyAudit({ ...fixture(), audit })).toThrow('Unapproved dependency vulnerabilities remain')
  }
})

test('rejects missing, malformed and nonempty policy records even when the raw audit is clean', () => {
  for (const policy of [undefined, {}, { exceptions: null }, { exceptions: [], unknown: true }]) {
    expect(() => evaluateDependencyAudit({ ...fixture(), policy })).toThrow()
  }
  for (const exceptions of [[retiredException], [{ ...retiredException, expiresAt: '2099-01-01T00:00:00Z' }], [{}]]) {
    expect(() => evaluateDependencyAudit({ ...fixture(), policy: { exceptions } })).toThrow('No dependency exceptions are approved')
  }
})

test('rejects a retired CLI manifest entry, npm alias, or override on an otherwise clean audit', () => {
  for (const [section, name, specifier] of [
    ['dependencies', 'shadcn', '4.7.0'],
    ['devDependencies', 'shadcn', '4.7.0'],
    ['optionalDependencies', 'ui-cli', 'npm:shadcn'],
    ['peerDependencies', 'ui-cli', 'npm:shadcn@^4.7.0'],
  ]) {
    const input = fixture()
    input.manifests.webapp[section] = { ...input.manifests.webapp[section], [name]: specifier }
    input.lock.workspaces.webapp[section] = { ...input.manifests.webapp[section] }
    expect(() => evaluateDependencyAudit(input)).toThrow('Retired shadcn package referenced in dependency graph')
  }
  for (const overrides of [{ shadcn: '4.7.0' }, { 'shadcn@4': '4.7.0' }, { 'ui-cli': 'npm:shadcn@4.7.0' }]) {
    const input = fixture()
    input.manifests[''].overrides = overrides
    input.lock.overrides = overrides
    expect(() => evaluateDependencyAudit(input)).toThrow('Retired shadcn package referenced in dependency graph')
  }
})

test('rejects a locked CLI instance, alias and transitive reference', () => {
  for (const [key, entry] of [
    ['shadcn', ['shadcn@4.7.0', '', {}]],
    ['ui-cli', ['shadcn@4.7.0', '', {}]],
    ['other/shadcn', ['shadcn@4.7.0', '', {}]],
    ['other', ['other@1.0.0', '', { optionalDependencies: { shadcn: '*' } }]],
    ['other', ['other@1.0.0', '', { peerDependencies: { 'ui-cli': 'npm:shadcn@4.7.0' } }]],
  ]) {
    const input = fixture(); input.lock.packages[key] = entry
    expect(() => evaluateDependencyAudit(input)).toThrow('Retired shadcn package referenced in dependency graph')
  }
})

test('retains workspace and lock schema consistency checks', () => {
  for (const mutate of [
    (f) => { f.manifests.backend.dependencies = { braces: '3.0.3' } },
    (f) => { f.manifests.extra = { dependencies: { braces: '3.0.3' } } },
    (f) => { f.manifests[''].overrides = { braces: '3.0.3' } },
    (f) => { f.lock.lockfileVersion = 2 },
    (f) => { f.lock.packages.alias = ['alias@workspace:unknown'] },
    (f) => { f.lock.packages.braces[2] = { dependencies: { 'fill-range': null } } },
  ]) {
    const input = fixture(); mutate(input)
    expect(() => evaluateDependencyAudit(input)).toThrow()
  }
})

test('rejects package source literals and the former CSS import', () => {
  for (const [path, content] of [
    ['backend/src/main.ts', 'import "shadcn"'],
    ['webapp/src/main.ts', 'import("npm:shadcn@4.7.0")'],
    ['webapp/src/index.css', '@import "shadcn/tailwind.css";'],
    ['webapp/src/index.css', '@import url(shadcn/tailwind.css);'],
  ]) {
    const input = fixture(); input.sources.push({ path, content })
    expect(() => evaluateDependencyAudit(input)).toThrow('Retired shadcn package literal in production source')
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
