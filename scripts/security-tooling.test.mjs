import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

test('exposes the approved security scanners through stable repository commands', () => {
  expect(packageJson.scripts['security:gitleaks']).toBe('bun scripts/security-scan.mjs gitleaks')
  expect(packageJson.scripts['security:semgrep']).toBe('bun scripts/security-scan.mjs semgrep')
  expect(packageJson.scripts['security:trivy:config']).toBe('bun scripts/security-scan.mjs trivy-config')
  expect(packageJson.scripts['security:trivy:image']).toBe('bun scripts/security-scan.mjs trivy-image')
  expect(packageJson.scripts['security:zap']).toBe('bun scripts/zap-api-scan.mjs')
})

test('pins every security scanner container to a version and immutable digest', () => {
  const tools = JSON.parse(readFileSync(resolve(root, '.security/tools.json'), 'utf8'))

  expect(Object.keys(tools).sort()).toEqual(['gitleaks', 'semgrep', 'trivy', 'zap'])
  for (const tool of Object.values(tools)) {
    expect(tool.image).toMatch(/^[^\s:]+(?:\/[^\s:@]+)+:[^\s@]+@sha256:[a-f0-9]{64}$/)
  }
})

test('dry-run scanner plans keep source read-only and reports outside tracked source', () => {
  for (const scanner of ['gitleaks', 'semgrep', 'trivy-config']) {
    const result = spawnSync('bun', ['scripts/security-scan.mjs', scanner, '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.command).toBe('docker')
    expect(plan.args).toContain('--rm')
    expect(plan.args.join(' ')).not.toContain('/src:rw')
  }
})

test('Trivy image scanning requires an explicit local image', () => {
  const missing = spawnSync('bun', ['scripts/security-scan.mjs', 'trivy-image', '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  })
  expect(missing.status).toBe(1)
  expect(missing.stderr).toContain('trivy-image requires an image reference')

  const planned = spawnSync(
    'bun',
    ['scripts/security-scan.mjs', 'trivy-image', 'anomaly-detector-backend:test', '--dry-run'],
    { cwd: root, encoding: 'utf8' },
  )
  expect(planned.status).toBe(0)
  const args = JSON.parse(planned.stdout).args
  expect(args).toContain('anomaly-detector-backend:test')
  expect(args.some((argument) => argument.endsWith(':/var/run/docker.sock'))).toBe(true)
})

test('backend runtime image upgrades Alpine security packages before dropping privileges', () => {
  const dockerfile = readFileSync(resolve(root, 'backend/Dockerfile'), 'utf8')
  const runtime = dockerfile.slice(dockerfile.indexOf(' AS runtime'))

  expect(runtime).toContain('RUN apk upgrade --no-cache')
  expect(runtime.indexOf('RUN apk upgrade --no-cache')).toBeLessThan(runtime.indexOf('USER bun'))
})

test('active ZAP orchestration is test-only, filters account deletion, and redacts reports', () => {
  const source = readFileSync(resolve(root, 'scripts/zap-api-scan.mjs'), 'utf8')
  const rules = readFileSync(resolve(root, '.zap/rules.tsv'), 'utf8')

  expect(source).toContain('assertTestDatabaseUrl(databaseUrlForHost)')
  expect(source).toContain("delete document.paths?.['/api/auth/account']?.delete")
  expect(source).toContain("source.replaceAll(secret, '[REDACTED]')")
  expect(source).toContain('enforceConfiguredFailures()')
  expect(source).not.toContain("'-c', '/zap/config/rules.tsv'")
  expect(source).toContain("'down', '--volumes', '--remove-orphans'")
  expect(source).not.toContain('anomaly-detector.ru')
  for (const ruleId of ['6', '40018', '90020']) {
    expect(rules).toContain(`${ruleId}\tFAIL\t`)
  }
})
