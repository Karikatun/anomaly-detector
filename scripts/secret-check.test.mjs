import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { findSecretViolations } from './secret-check.mjs'

const scanner = resolve(import.meta.dirname, 'secret-check.mjs')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('secret hygiene', () => {
  test('detects private keys, provider tokens, and credential filenames', () => {
    const result = findSecretViolations([
      file('notes.txt', ['-----BEGIN', ' PRIVATE KEY-----'].join('')),
      file('src/config.ts', `const token = '${githubToken()}'`),
      file('certificates/production.pem', 'certificate'),
      file('backend/.env.example', 'DATABASE_URL=postgresql://example'),
    ])

    expect(result.map((item) => item.path)).toEqual([
      'certificates/production.pem',
      'notes.txt',
      'src/config.ts',
    ])
  })

  test('scans staged content without printing the secret value', () => {
    const root = createRepository()
    const secret = githubToken()
    writeFileSync(join(root, 'src', 'config.ts'), `export const token = '${secret}'\n`)
    runGit(root, ['add', 'src/config.ts'])

    const result = runScanner(root, '--staged')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('src/config.ts: possible GitHub token')
    expect(result.stderr).not.toContain(secret)
  })

  test('scans tracked extensionless configuration files', () => {
    const root = createRepository()
    writeFileSync(join(root, '.npmrc'), `//registry.example/:_authToken=${githubToken()}\n`)
    runGit(root, ['add', '.npmrc'])

    const result = runScanner(root, '--staged')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('.npmrc: possible GitHub token')
  })

  test('ignores an untracked local backend env file', () => {
    const root = createRepository()
    writeFileSync(join(root, 'backend', '.env'), `TOKEN=${githubToken()}\n`)

    const staged = runScanner(root, '--staged')
    const tracked = runScanner(root, '--tracked')

    expect(staged.status).toBe(0)
    expect(tracked.status).toBe(0)
  })
})

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'thegame-secret-check-'))
  temporaryDirectories.push(root)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'backend'))
  runGit(root, ['init', '--quiet'])
  writeFileSync(join(root, 'src', 'safe.ts'), 'export const safe = true\n')
  runGit(root, ['add', 'src/safe.ts'])
  return root
}

function runScanner(root, mode) {
  return spawnSync('bun', [scanner, '--root', root, mode], {
    cwd: root,
    encoding: 'utf8',
  })
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

function githubToken() {
  return ['ghp', '_abcdefghijklmnopqrstuvwxyz1234567890'].join('')
}

function file(path, source) {
  return { path, source }
}
