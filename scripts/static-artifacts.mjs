import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { secretContentKinds } from './secret-check.mjs'

const privateExtension = /\.(?:bak|backup|old|orig|save|swp|swo|tmp|sql|dump|zip|tar|tgz|gz|bz2|xz|7z|rar|key|pem|p12|pfx|map)(?:\.|$)|~$/i

export function assertStaticArtifacts(directory) {
  const root = resolve(directory)
  const violations = []
  // lstat deliberately rejects symlinks before reading either files or directories.
  function visit(path, parts) {
    const label = JSON.stringify(parts.join('/') || '.')
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      violations.push(`${label}: unsupported static file type`)
      return
    }
    if (parts.some((part, index) => part.startsWith('.') && !(index === 0 && part === '.well-known'))
      || parts.some((part) => privateExtension.test(part))) {
      violations.push(`${label}: forbidden static file`)
      return
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name), [...parts, name])
      return
    }
    // Scan every file, including extensionless and generated output. Never print content.
    for (const kind of secretContentKinds(readFileSync(path).toString('utf8'))) {
      violations.push(`${label}: possible ${kind}`)
    }
  }
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('Static artifact root must be a real directory')
  }
  if (!lstatSync(join(root, 'index.html')).isFile()) {
    throw new Error('Static artifacts must contain index.html')
  }
  visit(root, [])
  if (violations.length) throw new Error(`Unsafe static artifacts:\n${violations.join('\n')}`)
}

/** @returns {import('vite').Plugin} */
export function staticArtifactGuard() {
  let directory
  return {
    name: 'static-artifact-guard',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      directory = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      assertStaticArtifacts(directory)
    },
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length < 3) throw new Error('Usage: bun scripts/static-artifacts.mjs <static-directory> [...]')
    for (const directory of process.argv.slice(2)) assertStaticArtifacts(directory)
    console.log('Static artifact hygiene: OK')
  } catch (error) {
    // Filesystem errors contain paths only; credential contents never enter diagnostics.
    console.error(error instanceof Error ? error.message : 'Static artifact check failed')
    process.exit(1)
  }
}
