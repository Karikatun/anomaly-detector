import { createHash } from 'node:crypto'
import { existsSync, lstatSync, opendirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BUNDLES = 64
const MAX_FILES_PER_BUNDLE = 2_000
const MAX_TOTAL_ENTRIES = 2_000
const MAX_DIRECTORY_DEPTH = 32
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const NAME = /^[a-z0-9][a-z0-9-]*$/
const failure = () => new Error('Skill bundle integrity verification failed')
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))

export function computeBundleDigest(root, bundleRelativePath) {
  return inspectBundle(root, bundleRelativePath).digest
}

function inspectBundle(root, bundleRelativePath) {
  const rootPath = resolve(root)
  const agentsRoot = resolve(rootPath, '.agents')
  const skillsRoot = resolve(rootPath, '.agents/skills')
  const bundlePath = resolve(rootPath, bundleRelativePath)
  assertRealDirectory(agentsRoot)
  assertRealDirectory(skillsRoot)
  if (!isInside(skillsRoot, bundlePath) || bundlePath === skillsRoot) throw failure()
  assertRealDirectory(bundlePath)

  const manifest = []
  let totalBytes = 0
  let totalEntries = 0
  visit(bundlePath, 0)
  return { digest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), files: manifest.length }

  function visit(directory, depth) {
    const entries = readDirectoryEntries(directory)
    for (const entry of entries) {
      totalEntries++
      if (totalEntries > MAX_TOTAL_ENTRIES) throw failure()
      const absolutePath = resolve(directory, entry.name)
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw failure()
      if (stat.isDirectory()) {
        if (depth >= MAX_DIRECTORY_DEPTH) throw failure()
        visit(absolutePath, depth + 1)
        continue
      }
      if (stat.size > MAX_FILE_BYTES || manifest.length >= MAX_FILES_PER_BUNDLE) throw failure()
      totalBytes += stat.size
      if (totalBytes > MAX_BUNDLE_BYTES) throw failure()
      manifest.push({
        path: relative(bundlePath, absolutePath).split(sep).join('/'),
        bytes: stat.size,
        sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
      })
    }
  }
}

function readDirectoryEntries(directory, limit = MAX_TOTAL_ENTRIES) {
  const handle = opendirSync(directory)
  const entries = []
  try {
    for (;;) {
      const entry = handle.readSync()
      if (!entry) break
      if (entries.length >= limit) throw failure()
      entries.push(entry)
    }
  } finally {
    handle.closeSync()
  }
  return entries.sort((left, right) => compareUtf8(left.name, right.name))
}

export function verifySkills(root) {
  try {
    const rootPath = resolve(root)
    const skillsRoot = resolve(rootPath, '.agents/skills')
    const securityRoot = resolve(rootPath, '.security')
    assertRealDirectory(skillsRoot)
    assertRealDirectory(securityRoot)
    const manifestPath = resolve(securityRoot, 'skills.json')
    assertRegularFile(manifestPath)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest?.version !== 1 || !Array.isArray(manifest.bundles)
      || manifest.bundles.length === 0 || manifest.bundles.length > MAX_BUNDLES) throw failure()

    const pinnedDirectories = new Set()
    let files = 0
    for (const bundle of manifest.bundles) {
      if (!bundle || typeof bundle !== 'object' || !NAME.test(bundle.name)
        || bundle.path !== `.agents/skills/${bundle.name}` || !SHA256.test(bundle.sha256)
        || pinnedDirectories.has(bundle.name)) throw failure()
      pinnedDirectories.add(bundle.name)
      const inspection = inspectBundle(rootPath, bundle.path)
      if (inspection.digest !== bundle.sha256) throw failure()
      files += inspection.files
    }

    const installedDirectories = readDirectoryEntries(skillsRoot, MAX_BUNDLES)
    for (const entry of installedDirectories) {
      const path = resolve(skillsRoot, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isDirectory() || !pinnedDirectories.has(entry.name)) throw failure()
    }
    if (installedDirectories.length !== pinnedDirectories.size) throw failure()
    return { bundles: manifest.bundles.length, files }
  } catch (error) {
    if (error?.message === 'Skill bundle integrity verification failed') throw error
    throw failure()
  }
}

function assertRealDirectory(path) {
  if (!existsSync(path)) throw failure()
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure()
}

function assertRegularFile(path) {
  if (!existsSync(path)) throw failure()
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw failure()
}

function isInside(parent, child) {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith('..')
}

if (import.meta.main) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const result = verifySkills(root)
    process.stdout.write(`Skill bundle integrity: OK (${result.bundles} bundles, ${result.files} files)\n`)
  } catch (error) {
    process.stderr.write('Skill bundle integrity verification failed\n')
    process.exitCode = 1
  }
}
