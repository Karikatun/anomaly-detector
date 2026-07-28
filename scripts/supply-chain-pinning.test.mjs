import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

test('pins GitHub Actions to immutable commit SHAs', () => {
  const workflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8')
  const actionReferences = [...workflow.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)]
    .map((match) => match[1])

  expect(actionReferences.length).toBeGreaterThan(0)
  for (const reference of actionReferences) {
    expect(reference).toMatch(/^[a-f0-9]{40}$/)
  }
})

test('pins Docker base and Compose images to immutable manifest digests', () => {
  const dockerfile = readFileSync(resolve(repoRoot, 'backend/Dockerfile'), 'utf8')
  const compose = readFileSync(resolve(repoRoot, 'docker-compose.yml'), 'utf8')
  const imageReferences = [
    ...dockerfile.matchAll(/^FROM\s+(\S+)/gm),
    ...compose.matchAll(/^\s*image:\s*(\S+)/gm),
  ].map((match) => match[1])

  expect(imageReferences.length).toBeGreaterThan(0)
  for (const reference of imageReferences) {
    expect(reference).toMatch(/^[^@\s]+@sha256:[a-f0-9]{64}$/)
  }
})
