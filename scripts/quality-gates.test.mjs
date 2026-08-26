import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const dynamicSecurityWorkflow = readFileSync(
  resolve(root, '.github/workflows/security-dynamic.yml'),
  'utf8',
)

test('defines fast commit and complete push quality gates', () => {
  expect(packageJson.workspaces).toContain('adminapp')
  expect(packageJson.scripts.prepare).toBe('bun scripts/install-git-hooks.mjs')
  expect(packageJson.scripts['security:secrets']).toContain('--tracked')
  expect(packageJson.scripts['security:secrets:staged']).toContain('--staged')
  expect(packageJson.scripts['security:dependencies']).toBe('bun audit --audit-level=low')
  expect(packageJson.scripts['check:commit']).toContain('test:backend:unit')
  expect(packageJson.scripts['check:commit']).toContain('test:website')
  expect(packageJson.scripts['check:commit']).not.toContain('e2e:webapp')
  expect(packageJson.scripts['check:push']).toBe(
    'bun run security:dependencies && bun run security:gitleaks && bun run check',
  )
  expect(packageJson.scripts.check).toContain('smoke:backend:docker')
  expect(packageJson.scripts.check).toContain('e2e:webapp')
  expect(packageJson.scripts.lint).toContain('adminapp')
  expect(packageJson.scripts.test).toContain('test:adminapp')
  expect(packageJson.scripts.test).toContain('test:website')
})

test('runs secret hygiene and tooling contracts in remote CI', () => {
  expect(workflow).toContain('run: bun run security:dependencies')
  expect(workflow).toContain('run: bun run security:secrets')
  expect(workflow).toContain('run: bun run security:gitleaks')
  expect(workflow).toContain('run: bun run security:semgrep')
  expect(workflow).toContain('bun run security:trivy:image anomaly-detector-backend:smoke')
  expect(workflow).toContain('run: bun run test:tooling')
  expect(workflow).toContain('run: bun run test:adminapp')
  expect(workflow).toContain('run: bun run test:website')
})

test('runs each E2E browser on an isolated runner behind one required aggregate', () => {
  const browserStart = workflow.indexOf('\n  e2e-browser:\n')
  const aggregateStart = workflow.indexOf('\n  e2e:\n')
  expect(browserStart).toBeGreaterThan(-1)
  expect(aggregateStart).toBeGreaterThan(browserStart)

  const browserJob = workflow.slice(browserStart, aggregateStart)
  expect(browserJob).toContain('fail-fast: false')
  expect(browserJob).toContain('browser: [chromium, firefox]')
  expect(browserJob).toContain('key: playwright-${{ runner.os }}-${{ matrix.browser }}-')
  expect(browserJob).toContain('E2E_WORKERS: 1')
  expect(browserJob).toContain('bun run e2e:webapp -- --project=${{ matrix.browser }}')
  expect(browserJob).not.toContain('continue-on-error')

  const aggregate = workflow.slice(aggregateStart)
  expect(aggregate).toContain('name: e2e')
  expect(aggregate).toContain('needs: e2e-browser')
  expect(aggregate).toContain('if: ${{ always() }}')
  expect(aggregate).toContain('E2E_BROWSER_RESULT: ${{ needs.e2e-browser.result }}')
  expect(aggregate).toContain('test "$E2E_BROWSER_RESULT" = success')
})

test('runs active ZAP only on an isolated scheduled or manual workflow', () => {
  expect(dynamicSecurityWorkflow).toContain('workflow_dispatch:')
  expect(dynamicSecurityWorkflow).toContain('schedule:')
  expect(dynamicSecurityWorkflow).toContain('run: bun run security:zap')
  expect(dynamicSecurityWorkflow).toContain('POSTGRES_TEST_PORT:')
  expect(dynamicSecurityWorkflow).not.toContain('pull_request:')
  expect(dynamicSecurityWorkflow).not.toContain('push:')
})

test('keeps every required versioned hook installed', () => {
  const installer = readFileSync(resolve(root, 'scripts/install-git-hooks.mjs'), 'utf8')
  for (const hook of ['commit-msg', 'pre-commit', 'pre-push']) {
    expect(installer).toContain(`'${hook}'`)
    expect(readFileSync(resolve(root, '.githooks', hook), 'utf8')).toContain('#!/bin/sh')
  }
})
