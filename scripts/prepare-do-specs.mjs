#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratchDir = resolve(repoRoot, '.scratch/deploy')
const targets = new Set(['backend-initial', 'backend-final', 'web', 'landing', 'all'])
const target = process.argv[2]

if (!targets.has(target)) {
  printUsage()
  process.exit(1)
}

const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'))
const projectSlug = doName(process.env.DO_PROJECT_SLUG ?? packageJson.name ?? 'app')
const gitBranch = requiredBranch()
const githubRepo = requiredGithubRepo()
const appRegion = process.env.DO_APP_REGION?.trim() || 'nyc'
const dbComponentName = doName(process.env.DO_DB_COMPONENT_NAME ?? `${projectSlug}-db`, 32)
const dbClusterName = doName(process.env.DO_DB_CLUSTER_NAME ?? `${projectSlug}-pg`)
const dbName = process.env.DO_DB_NAME?.trim() || 'defaultdb'
const dbUser = process.env.DO_DB_USER?.trim() || 'doadmin'

await mkdir(scratchDir, { recursive: true })

if (target === 'backend-initial' || target === 'backend-final' || target === 'all') {
  const jwtSecret = requiredEnv('JWT_SECRET')
  assertMinLength('JWT_SECRET', jwtSecret, 32)
  const webUrl = target === 'backend-initial' ? 'https://placeholder.invalid' : requiredUrlEnv('DO_WEB_URL')

  await writePreparedSpec('backend-app.yaml.example', 'backend-app.yaml', {
    ...commonReplacements(),
    REPLACE_WITH_AT_LEAST_32_RANDOM_CHARS: jwtSecret,
    'https://REPLACE_WITH_WEB_DEFAULT_INGRESS': webUrl,
  })
}

if (target === 'web' || target === 'all') {
  await writePreparedSpec('web-static-app.yaml.example', 'web-static-app.yaml', {
    ...commonReplacements(),
    'https://REPLACE_WITH_BACKEND_DEFAULT_INGRESS': requiredUrlEnv('DO_BACKEND_URL'),
  })
}

if (target === 'landing' || target === 'all') {
  await writePreparedSpec('landing-static-app.yaml.example', 'landing-static-app.yaml', {
    ...commonReplacements(),
    'https://REPLACE_WITH_WEB_DEFAULT_INGRESS': requiredUrlEnv('DO_WEB_URL'),
  })
}

console.log(`Prepared DigitalOcean specs under ${scratchDir}`)

function commonReplacements() {
  return {
    REPLACE_WITH_PROJECT_SLUG: projectSlug,
    REPLACE_WITH_DO_APP_REGION: appRegion,
    REPLACE_WITH_GITHUB_REPO: githubRepo,
    REPLACE_WITH_GIT_BRANCH: gitBranch,
    REPLACE_WITH_DO_DB_COMPONENT_NAME: dbComponentName,
    REPLACE_WITH_DO_DB_CLUSTER_NAME: dbClusterName,
    REPLACE_WITH_DO_DB_NAME: dbName,
    REPLACE_WITH_DO_DB_USER: dbUser,
  }
}

async function writePreparedSpec(templateName, outputName, replacements) {
  const templatePath = resolve(repoRoot, '.do', templateName)
  const outputPath = resolve(scratchDir, outputName)
  let contents = await readFile(templatePath, 'utf8')

  for (const [placeholder, value] of Object.entries(replacements)) {
    contents = contents.split(placeholder).join(value)
  }

  assertNoPlaceholders(outputName, contents)
  assertNoEmptyYamlValues(outputName, contents)
  assertSafeProductionEnv(outputName, contents)
  await writeFile(outputPath, contents)
}

function printUsage() {
  console.error(`Usage: bun scripts/prepare-do-specs.mjs <${[...targets].join('|')}>`)
  console.error('')
  console.error('Required env:')
  console.error('  all targets: DO_GITHUB_REPO, optional DO_PROJECT_SLUG, DO_GIT_BRANCH, DO_APP_REGION')
  console.error('  backend-initial: JWT_SECRET')
  console.error('  backend-final: JWT_SECRET, DO_WEB_URL')
  console.error('  web: DO_BACKEND_URL')
  console.error('  landing: DO_WEB_URL')
  console.error('  all: JWT_SECRET, DO_BACKEND_URL, DO_WEB_URL')
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required and cannot be empty`)
  }

  return value
}

function requiredUrlEnv(name) {
  return normalizeHttpsUrl(name, requiredEnv(name))
}

function normalizeHttpsUrl(name, value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      throw new Error('URL must use https')
    }
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    throw new Error(`${name} must be an absolute https URL: ${error.message}`)
  }
}

function requiredGithubRepo() {
  const repo = requiredEnv('DO_GITHUB_REPO')

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('DO_GITHUB_REPO must use owner/repo format')
  }

  return repo
}

function requiredBranch() {
  const explicit = process.env.DO_GIT_BRANCH?.trim()
  if (explicit) return explicit

  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    return branch || 'main'
  } catch {
    return 'main'
  }
}

function assertMinLength(name, value, minimum) {
  if (value.length < minimum) {
    throw new Error(`${name} must be at least ${minimum} characters`)
  }
}

function assertNoPlaceholders(outputName, contents) {
  const placeholders = contents.match(/REPLACE_WITH_[A-Z0-9_]+/g)

  if (placeholders) {
    throw new Error(`${outputName} still contains placeholders: ${[...new Set(placeholders)].join(', ')}`)
  }
}

function assertNoEmptyYamlValues(outputName, contents) {
  const emptyValueLine = contents
    .split('\n')
    .find((line) => /^\s+value:\s*(?:""|'')?\s*$/.test(line))

  if (emptyValueLine) {
    throw new Error(`${outputName} contains an empty YAML value line: ${emptyValueLine.trim()}`)
  }
}

function assertSafeProductionEnv(outputName, contents) {
  const jwtSecret = findEnvValue(contents, 'JWT_SECRET')
  if (jwtSecret !== undefined) {
    assertMinLength('JWT_SECRET', jwtSecret, 32)
  }

  const corsOrigins = findEnvValue(contents, 'CORS_ORIGINS')
  if (corsOrigins !== undefined) {
    assertCorsOrigins(outputName, corsOrigins)
  }

  for (const key of ['VITE_API_URL', 'PUBLIC_WEB_APP_URL']) {
    const value = findEnvValue(contents, key)
    if (value !== undefined) {
      assertBuildTimeHttpsUrl(outputName, key, value)
    }
  }
}

function findEnvValue(contents, key) {
  const lines = contents.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`^\\s*-\\s*key:\\s*${escapeRegExp(key)}\\s*$`).test(lines[index])) continue

    for (let valueIndex = index + 1; valueIndex < lines.length; valueIndex += 1) {
      if (/^\s*-\s*key:\s*/.test(lines[valueIndex])) break
      const match = lines[valueIndex].match(/^\s*value:\s*(.+?)\s*$/)
      if (match) return unquoteYamlScalar(match[1].trim())
    }
  }

  return undefined
}

function assertCorsOrigins(outputName, value) {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    throw new Error(`${outputName} has empty CORS_ORIGINS`)
  }

  for (const origin of origins) {
    if (origin === '*') {
      throw new Error(`${outputName} must not use wildcard CORS_ORIGINS in production`)
    }

    const normalized = normalizeHttpsUrl('CORS_ORIGINS', origin)
    if (normalized !== new URL(normalized).origin) {
      throw new Error(`${outputName} CORS_ORIGINS must contain origins only, not paths: ${origin}`)
    }
  }
}

function assertBuildTimeHttpsUrl(outputName, key, value) {
  if (value.startsWith('${')) return

  const normalized = normalizeHttpsUrl(key, value)
  if (normalized !== new URL(normalized).origin) {
    throw new Error(`${outputName} ${key} must be an origin URL without a path: ${value}`)
  }
}

function doName(value, maxLength = 63) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const withLetterStart = /^[a-z]/.test(normalized) ? normalized : `app-${normalized}`
  const fallback = withLetterStart === 'app-' ? 'app-template' : withLetterStart
  return fallback.slice(0, maxLength).replace(/-+$/g, '') || 'app-template'
}

function unquoteYamlScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
