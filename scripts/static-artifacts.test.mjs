import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'vite'
import { build as buildAstro } from 'astro'

import { staticArtifactGuard } from './static-artifacts.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'anomaly-static-artifacts-')))
  roots.push(root)
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Public fixture</title>')
  return root
}

function scan(root) {
  return spawnSync(process.execPath, [resolve(import.meta.dirname, 'static-artifacts.mjs'), root], {
    encoding: 'utf8',
  })
}

test('rejects an environment backup in a published directory without printing its contents', () => {
  const root = fixture()
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'assets', '.env.bak'), 'SYNTHETIC_PRIVATE_PAYLOAD')
  const result = scan(root)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('forbidden static file')
  expect(result.stderr).not.toContain('SYNTHETIC_PRIVATE_PAYLOAD')
})

test('accepts ordinary assets and root well-known resources', () => {
  const root = fixture()
  for (const path of ['assets/app.js', 'assets/font.woff2', '.well-known/security.txt', '.well-known/acme-challenge/fixture']) {
    mkdirSync(resolve(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), 'public fixture')
  }
  expect(scan(root).status).toBe(0)
})

test('rejects nested metadata, backups, dumps, keys and sourcemaps regardless of case', () => {
  for (const path of ['.env.example', '.git/config', 'assets/.ENV.BAK', '.well-known/nested/.env',
    'backup.zip', 'nested/data.SQL.gz', 'assets/app.js.map', 'key.pem', 'config.json~']) {
    const root = fixture()
    mkdirSync(resolve(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), 'synthetic')
    expect({ path, status: scan(root).status }).toEqual({ path, status: 1 })
  }
})

test('scans generated and extensionless files without exposing detected token values', () => {
  const token = ['ghp', '_abcdefghijklmnopqrstuvwxyz1234567890'].join('')
  const root = fixture()
  mkdirSync(join(root, 'generated'))
  writeFileSync(join(root, 'generated', 'payload'), token)
  const result = scan(root)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('possible GitHub token')
  expect(result.stderr).not.toContain(token)
})

test('refuses symlinks, including the root, without following private targets', () => {
  const root = fixture()
  const outside = fixture()
  writeFileSync(join(outside, 'private'), 'PRIVATE_SYNTHETIC_VALUE')
  symlinkSync(join(outside, 'private'), join(root, 'asset.txt'))
  symlinkSync(outside, join(root, 'linked-directory'))
  const result = scan(root)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('unsupported static file type')
  expect(result.stderr).not.toContain('PRIVATE_SYNTHETIC_VALUE')
  expect(scan(join(root, 'linked-directory')).status).toBe(1)
})

test('fails closed for missing or incomplete output and missing CLI arguments', () => {
  const root = fixture()
  mkdirSync(join(root, 'empty'))
  expect(scan(join(root, 'absent')).status).toBe(1)
  expect(scan(join(root, 'empty')).status).toBe(1)
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'static-artifacts.mjs')])
  expect(result.status).toBe(1)
})

test('the real Vite build checks the resolved custom output after public files are copied', async () => {
  const root = fixture()
  mkdirSync(join(root, 'public'))
  writeFileSync(join(root, 'public', '.env.bak'), 'synthetic fixture')
  await expect(build({
    configFile: false, root, logLevel: 'silent', plugins: [staticArtifactGuard()],
    build: { outDir: 'custom-output' },
  })).rejects.toThrow('forbidden static file')
})

test('the actual Astro integration rejects a backup copied into completed static output', async () => {
  const root = fixture()
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'))
  mkdirSync(join(root, 'src', 'pages'), { recursive: true })
  mkdirSync(join(root, 'public'))
  writeFileSync(join(root, 'src', 'pages', 'index.astro'), '<html><title>Fixture</title></html>')
  writeFileSync(join(root, 'public', 'backup.zip'), 'synthetic archive')
  await expect(buildAstro({
    root, configFile: relative(root, resolve(import.meta.dirname, '../website/astro.config.mjs')), logLevel: 'silent',
  })).rejects.toThrow('forbidden static file')
})
