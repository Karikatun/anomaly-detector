import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const sourceRoots = ['backend/src', 'webapp/src', 'adminapp/src', 'website/src', 'packages']
const sourceExtension = /\.(?:[cm]?[jt]sx?|astro|css)$/
const retiredModuleLiteral = /(["'`])(?:npm:)?shadcn(?:[@/][^"'`\s]*)?\1/
const retiredCssImport = /@import\s+url\(\s*(?:npm:)?shadcn(?:[@/][^\s)]+)?\s*\)/i

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys, label) {
  requireCondition(object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `Unknown ${label} schema`)
}

function sortedEntries(value) {
  requireCondition(object(value), 'Invalid dependency map')
  requireCondition(Object.values(value).every((entry) => typeof entry === 'string'), 'Invalid dependency specifier')
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
}

function validatePolicy(policy) {
  exactKeys(policy, ['exceptions'], 'exception policy')
  requireCondition(Array.isArray(policy.exceptions) && policy.exceptions.length === 0, 'No dependency exceptions are approved')
}

function isRetiredPackage(name) {
  return name === 'shadcn' || name.startsWith('shadcn@')
}

function requireNoRetiredDependencies(entries) {
  for (const [name, specifier] of entries) {
    requireCondition(!isRetiredPackage(name) && !/^npm:shadcn(?:@|$)/.test(specifier), 'Retired shadcn package referenced in dependency graph')
  }
}

function validateGraph(lock, manifests) {
  requireCondition(object(lock) && lock.lockfileVersion === 1 && lock.configVersion === 1 && object(lock.packages) && object(lock.workspaces), 'Unknown Bun lock schema')
  requireCondition(object(manifests) && object(manifests['']), 'Missing workspace manifests')
  requireCondition(JSON.stringify(Object.keys(lock.workspaces).sort()) === JSON.stringify(Object.keys(manifests).sort()), 'Workspace manifest set differs from lock')
  const overrides = sortedEntries(lock.overrides ?? {})
  requireCondition(JSON.stringify(overrides) === JSON.stringify(sortedEntries(manifests[''].overrides ?? {})), 'Overrides differ from lock')
  requireNoRetiredDependencies(overrides)

  for (const [workspace, manifest] of Object.entries(manifests)) {
    for (const section of sections) {
      const dependencies = sortedEntries(manifest[section] ?? {})
      requireCondition(JSON.stringify(dependencies) === JSON.stringify(sortedEntries(lock.workspaces[workspace][section] ?? {})), 'Workspace dependencies differ from lock')
      requireNoRetiredDependencies(dependencies)
    }
  }

  for (const [key, entry] of Object.entries(lock.packages)) {
    requireCondition(Array.isArray(entry) && typeof entry[0] === 'string', 'Unknown locked package schema')
    requireCondition(!isRetiredPackage(key) && !isRetiredPackage(entry[0]), 'Retired shadcn package referenced in dependency graph')
    if (entry.length === 1 && entry[0].startsWith(`${key}@workspace:`)) {
      const workspace = entry[0].slice(`${key}@workspace:`.length)
      requireCondition(Object.hasOwn(lock.workspaces, workspace) && manifests[workspace].name === key, 'Unknown locked workspace link')
      continue
    }
    const metadata = entry[2]
    requireCondition(object(metadata), 'Unknown locked dependency schema')
    for (const section of sections) requireNoRetiredDependencies(sortedEntries(metadata[section] ?? {}))
  }
}

function validateSources(sources) {
  requireCondition(Array.isArray(sources), 'Missing production source scope')
  for (const { path, content } of sources) {
    requireCondition(typeof path === 'string' && typeof content === 'string', 'Invalid source input')
    requireCondition(!retiredModuleLiteral.test(content) && !retiredCssImport.test(content), 'Retired shadcn package literal in production source')
  }
}

function parseAudit(audit) {
  requireCondition(!audit.error && !audit.signal && [0, 1].includes(audit.status), 'Dependency audit process failed')
  const stderr = (audit.stderr ?? '').replace(/\u001b\[[0-9;]*m/g, '').trim()
  requireCondition(stderr === '' || /^bun audit v\d+\.\d+\.\d+ \([a-f0-9]+\)$/.test(stderr), 'Dependency audit returned a diagnostic or warning')
  const data = JSON.parse(audit.stdout)
  requireCondition(object(data), 'Unknown dependency audit schema')
  const findings = []
  for (const [name, advisories] of Object.entries(data)) {
    requireCondition(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) && Array.isArray(advisories) && advisories.length > 0, 'Unknown dependency audit package schema')
    for (const advisory of advisories) {
      exactKeys(advisory, ['id', 'url', 'title', 'severity', 'vulnerable_versions', 'cwe', 'cvss'], 'advisory')
      exactKeys(advisory.cvss, ['score', 'vectorString'], 'advisory CVSS')
      requireCondition(Number.isSafeInteger(advisory.id) && advisory.id > 0 && /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(advisory.url), 'Invalid advisory identity')
      requireCondition(typeof advisory.title === 'string' && advisory.title.length > 0 && ['low', 'moderate', 'high', 'critical'].includes(advisory.severity), 'Unknown advisory severity or title')
      requireCondition(typeof advisory.vulnerable_versions === 'string' && advisory.vulnerable_versions.length > 0 && Array.isArray(advisory.cwe) && advisory.cwe.every((cwe) => /^CWE-\d+$/.test(cwe)), 'Invalid advisory range or CWE')
      requireCondition(Number.isFinite(advisory.cvss.score) && advisory.cvss.score >= 0 && advisory.cvss.score <= 10 && (advisory.cvss.vectorString === null || typeof advisory.cvss.vectorString === 'string'), 'Invalid advisory CVSS')
      findings.push({ name, ...advisory })
    }
  }
  requireCondition((findings.length === 0 && audit.status === 0) || (findings.length > 0 && audit.status === 1), 'Dependency audit status contradicts its results')
  return findings
}

export function evaluateDependencyAudit({ audit, policy, lock, manifests, sources }) {
  validatePolicy(policy)
  validateGraph(lock, manifests)
  validateSources(sources)
  const findings = parseAudit(audit)
  requireCondition(findings.length === 0, 'Unapproved dependency vulnerabilities remain')
  return { advisories: findings.length, exceptions: 0 }
}

export function readProductionSources(repositoryRoot) {
  const sources = []
  let bytes = 0
  function visit(path) {
    const stat = lstatSync(path)
    requireCondition(!stat.isSymbolicLink(), 'Unexpected symlink in production source scope')
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        // Workspace-local dependencies are installed inputs, not application sources.
        if (name !== 'node_modules') visit(resolve(path, name))
      }
    } else {
      requireCondition(stat.isFile(), 'Unexpected special file in production source scope')
      if (!sourceExtension.test(path)) return
      bytes += stat.size
      requireCondition(stat.size <= 8 * 1024 * 1024 && bytes <= 100 * 1024 * 1024 && sources.length < 50000, 'Production source scope exceeded safety bounds')
      sources.push({ path: relative(repositoryRoot, path).replaceAll('\\', '/'), content: readFileSync(path, 'utf8') })
    }
  }
  for (const path of sourceRoots) visit(resolve(repositoryRoot, path))
  return sources
}

function readManifests(repositoryRoot) {
  const manifests = { '': JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) }
  requireCondition(Array.isArray(manifests[''].workspaces), 'Unknown workspace configuration')
  for (const workspace of manifests[''].workspaces) {
    requireCondition(typeof workspace === 'string' && /^(?:[a-z][a-z0-9-]*|packages\/\*)$/.test(workspace), 'Unknown workspace path')
    const paths = workspace === 'packages/*'
      ? readdirSync(resolve(repositoryRoot, 'packages')).map((name) => `packages/${name}`)
      : [workspace]
    for (const path of paths) {
      requireCondition(lstatSync(resolve(repositoryRoot, path)).isDirectory(), 'Unexpected workspace entry')
      manifests[path] = JSON.parse(readFileSync(resolve(repositoryRoot, path, 'package.json'), 'utf8'))
    }
  }
  return manifests
}

if (import.meta.main) {
  try {
    const sources = readProductionSources(root)
    const result = evaluateDependencyAudit({
      policy: JSON.parse(readFileSync(resolve(root, '.security/dependency-exceptions.json'), 'utf8')),
      lock: Bun.JSONC.parse(readFileSync(resolve(root, 'bun.lock'), 'utf8')),
      manifests: readManifests(root),
      sources,
      audit: spawnSync(process.execPath, ['--no-env-file', 'audit', '--json', '--audit-level=low'], {
        cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      }),
    })
    process.stdout.write(`Dependency audit: ${result.advisories} advisory; ${result.exceptions} approved exceptions; ${sources.length} source files checked.\n`)
  } catch (error) {
    // Registry output and source contents are never echoed into CI logs.
    process.stderr.write(`Dependency audit failed: ${error instanceof SyntaxError ? 'invalid JSON input' : error.message}\n`)
    process.exitCode = 1
  }
}
