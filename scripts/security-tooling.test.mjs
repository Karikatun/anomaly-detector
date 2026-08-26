import { expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runZapCleanupSteps } from './zap-cleanup.mjs'
import { publishRedactedZapReports } from './zap-report-redaction.mjs'

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
  const redactionSource = readFileSync(resolve(root, 'scripts/zap-report-redaction.mjs'), 'utf8')
  const workflow = readFileSync(resolve(root, '.github/workflows/security-dynamic.yml'), 'utf8')
  const rules = readFileSync(resolve(root, '.zap/rules.tsv'), 'utf8')

  expect(source).toContain('assertTestDatabaseUrl(databaseUrlForHost)')
  expect(source).toContain("delete document.paths?.['/api/auth/account']?.delete")
  expect(source).toContain('publishRedactedZapReports(rawReportDirectory, reportDirectory, accessToken)')
  expect(redactionSource).toContain("source.replaceAll(secret, '[REDACTED]')")
  expect(source).toContain("'-r', 'raw-report.html'")
  expect(source).toContain("'-e', 'ZAP_AUTH_HEADER_VALUE'")
  expect(source).not.toContain('ZAP_AUTH_HEADER_VALUE=Bearer')
  expect(source).toContain('backendContainerLaunchAttempted = true')
  expect(source).toContain('removeContainerIfPresent(containerName)')
  expect(workflow).toContain('.scratch/security/zap/**/sanitized/report.*')
  expect(workflow).not.toContain('path: .scratch/security/zap/**/report.*')
  expect(workflow).toContain('if-no-files-found: error')
  expect(source).toContain('enforceConfiguredFailures()')
  expect(source).not.toContain("'-c', '/zap/config/rules.tsv'")
  expect(source).toContain("'down', '--volumes', '--remove-orphans'")
  expect(source).not.toContain('anomaly-detector.ru')
  for (const ruleId of ['6', '40018', '90020']) {
    expect(rules).toContain(`${ruleId}\tFAIL\t`)
  }
})

test('ZAP report redaction does not require write access to container-owned reports', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'anomaly-zap-reports-'))
  const rawDirectory = resolve(directory, 'raw')
  const sanitizedDirectory = resolve(directory, 'sanitized')
  const secret = 'header.payload.signature'

  try {
    mkdirSync(rawDirectory)
    for (const name of ['raw-report.html', 'raw-report.json', 'raw-report.md']) {
      const path = resolve(rawDirectory, name)
      writeFileSync(path, `before ${secret} after`)
      chmodSync(path, 0o444)
    }

    expect(() => publishRedactedZapReports(rawDirectory, sanitizedDirectory, secret)).not.toThrow()
    expect(existsSync(rawDirectory)).toBe(false)
    for (const name of ['report.html', 'report.json', 'report.md']) {
      const reportPath = resolve(sanitizedDirectory, name)
      const report = readFileSync(reportPath, 'utf8')
      expect(report).toContain('[REDACTED]')
      expect(report).not.toContain(secret)
      expect(statSync(reportPath).mode & 0o777).toBe(0o600)
    }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('ZAP report publication fails closed without a complete regular-file set', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'anomaly-zap-reports-'))
  const rawDirectory = resolve(directory, 'raw')
  const sanitizedDirectory = resolve(directory, 'sanitized')
  const outsidePath = resolve(directory, 'outside-report.html')

  try {
    mkdirSync(rawDirectory)
    writeFileSync(outsidePath, 'must remain untouched')
    symlinkSync(outsidePath, resolve(rawDirectory, 'raw-report.html'))
    writeFileSync(resolve(rawDirectory, 'raw-report.json'), '{}')
    writeFileSync(resolve(rawDirectory, 'raw-report.md'), '# report')

    expect(() => publishRedactedZapReports(rawDirectory, sanitizedDirectory, 'secret')).toThrow()
    expect(existsSync(sanitizedDirectory)).toBe(false)
    expect(existsSync(rawDirectory)).toBe(false)
    expect(readFileSync(outsidePath, 'utf8')).toBe('must remain untouched')
    expect(readdirSync(directory).some((name) => name.startsWith('.sanitized-'))).toBe(false)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('ZAP cleanup attempts every step and reports every failure', () => {
  const attempts = []
  const expectedError = new Error('spawn failed')
  const errors = runZapCleanupSteps([
    ['container cleanup', () => {
      attempts.push('container')
      return { status: 1 }
    }],
    ['database cleanup', () => {
      attempts.push('database')
      throw expectedError
    }],
    ['raw report cleanup', () => {
      attempts.push('raw')
    }],
  ])

  expect(attempts).toEqual(['container', 'database', 'raw'])
  expect(errors).toHaveLength(2)
  expect(errors[0]?.message).toBe('container cleanup failed with exit code 1')
  expect(errors[1]?.message).toBe('database cleanup failed')
  expect(errors[1]?.cause).toBe(expectedError)
})
