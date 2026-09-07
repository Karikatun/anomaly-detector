import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBundleDigest, verifySkills } from './verify-skills.mjs'

const fixtures = []
const FIXTURE_DIGEST = '3c7e5fe9d1ede0251bcb22f959d7ea0e7563caae2b8f8f19b3b1905fa368e7b5'

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('skill bundle verification', () => {
  test('accepts a complete tracked inventory with canonical full-bundle digest', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])

    expect(computeBundleDigest(fixture, '.agents/skills/example')).toBe(FIXTURE_DIGEST)
    expect(verifySkills(fixture)).toEqual({ bundles: 1, files: 4 })
  })

  test('rejects changed, added, and removed resources even when the manifest is unchanged', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])

    writeFileSync(join(fixture, '.agents/skills/example/SKILL.md'), 'changed')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    writeFixtureBundle(fixture)
    writeFileSync(join(fixture, '.agents/skills/example/new-resource.txt'), 'new')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    writeFixtureBundle(fixture)
    unlinkSync(join(fixture, '.agents/skills/example/reference.txt'))
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects symlinked bundle paths without following their targets', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])
    const outside = join(fixture, 'outside.txt')
    writeFileSync(outside, 'outside')

    unlinkSync(join(fixture, '.agents/skills/example/reference.txt'))
    symlinkSync(outside, join(fixture, '.agents/skills/example/reference.txt'))
    expect(() => computeBundleDigest(fixture, '.agents/skills/example')).toThrow('Skill bundle integrity verification failed')

    rmSync(join(fixture, '.agents/skills/example'), { recursive: true, force: true })
    symlinkSync(join(fixture, '.agents/skills'), join(fixture, '.agents/skills/example'), 'dir')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects malformed paths, duplicate bundles, and unpinned skill directories', () => {
    const fixture = createFixture()
    writeManifest(fixture, [
      { name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST },
      { name: 'duplicate', path: '.agents/skills/example', sha256: FIXTURE_DIGEST },
    ])
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    writeManifest(fixture, [{ name: 'escape', path: '.agents/skills/../outside', sha256: FIXTURE_DIGEST }])
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: 'not-a-sha256' }])
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])
    mkdirSync(join(fixture, '.agents/skills/unpinned'))
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects symlinked .agents ancestors and a symlinked security manifest', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])
    const outsideAgents = join(fixture, 'outside-agents')
    renameSync(join(fixture, '.agents'), outsideAgents)
    symlinkSync(outsideAgents, join(fixture, '.agents'), 'dir')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    unlinkSync(join(fixture, '.agents'))
    renameSync(outsideAgents, join(fixture, '.agents'))
    const manifestTarget = join(fixture, 'manifest-target.json')
    writeFileSync(manifestTarget, JSON.stringify({ version: 1, bundles: [] }))
    rmSync(join(fixture, '.security/skills.json'))
    symlinkSync(manifestTarget, join(fixture, '.security/skills.json'))
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects symlinked .agents/skills and .security directories', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])
    const outsideSkills = join(fixture, 'outside-skills')
    renameSync(join(fixture, '.agents/skills'), outsideSkills)
    symlinkSync(outsideSkills, join(fixture, '.agents/skills'), 'dir')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')

    unlinkSync(join(fixture, '.agents/skills'))
    renameSync(outsideSkills, join(fixture, '.agents/skills'))
    const outsideSecurity = join(fixture, 'outside-security')
    renameSync(join(fixture, '.security'), outsideSecurity)
    symlinkSync(outsideSecurity, join(fixture, '.security'), 'dir')
    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects excessive empty directories and a depth beyond the traversal limit', () => {
    const wide = createFixture()
    for (let index = 0; index <= 2_000; index++) mkdirSync(join(wide, `.agents/skills/example/wide-${index}`))
    expect(() => computeBundleDigest(wide, '.agents/skills/example')).toThrow('Skill bundle integrity verification failed')

    const deep = createFixture()
    let directory = join(deep, '.agents/skills/example')
    for (let index = 0; index <= 32; index++) {
      directory = join(directory, `deep-${index}`)
      mkdirSync(directory)
    }
    expect(() => computeBundleDigest(deep, '.agents/skills/example')).toThrow('Skill bundle integrity verification failed')
  })

  test('rejects more than 64 top-level skill directories', () => {
    const fixture = createFixture()
    writeManifest(fixture, [{ name: 'example', path: '.agents/skills/example', sha256: FIXTURE_DIGEST }])
    for (let index = 0; index < 64; index++) mkdirSync(join(fixture, `.agents/skills/extra-${index}`))

    expect(() => verifySkills(fixture)).toThrow('Skill bundle integrity verification failed')
  })
})

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'anomaly-verify-skills-'))
  fixtures.push(root)
  mkdirSync(join(root, '.security'), { recursive: true })
  writeFixtureBundle(root)
  return root
}

function writeFixtureBundle(root) {
  rmSync(join(root, '.agents/skills/example'), { recursive: true, force: true })
  mkdirSync(join(root, '.agents/skills/example'), { recursive: true })
  writeFileSync(join(root, '.agents/skills/example/SKILL.md'), 'skill')
  writeFileSync(join(root, '.agents/skills/example/reference.txt'), 'reference')
  mkdirSync(join(root, '.agents/skills/example/nested'))
  writeFileSync(join(root, '.agents/skills/example/nested/a.txt'), 'a')
  writeFileSync(join(root, '.agents/skills/example/nested/é.txt'), 'é')
}

function writeManifest(root, bundles) {
  writeFileSync(join(root, '.security/skills.json'), JSON.stringify({ version: 1, bundles }))
}
