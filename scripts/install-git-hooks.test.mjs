import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const installer = resolve(import.meta.dirname, 'install-git-hooks.mjs')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Git hooks installer', () => {
  test('configures the repository to use all versioned hooks', () => {
    const root = createFixture()

    const result = runInstaller(root)

    expect(result.status).toBe(0)
    expect(readFileSync(join(root, 'git.log'), 'utf8').trim().split('\n')).toEqual([
      'rev-parse --git-dir',
      'config --local core.hooksPath .githooks',
    ])
  })

  test('does not break dependency installation before git init', () => {
    const root = createFixture()

    const result = runInstaller(root, { FAKE_GIT_REPOSITORY: '0' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Git repository not found')
  })

  test('rejects an incomplete hooks directory', () => {
    const root = createFixture()
    rmSync(join(root, '.githooks', 'commit-msg'))

    const result = runInstaller(root)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing Git hook')
  })
})

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'thegame-hooks-'))
  temporaryDirectories.push(root)
  mkdirSync(join(root, '.githooks'))
  for (const hook of ['commit-msg', 'pre-commit', 'pre-push']) {
    writeFileSync(join(root, '.githooks', hook), '#!/bin/sh\n')
  }
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const fakeGit = join(bin, 'git')
  writeFileSync(fakeGit, `#!/bin/sh
printf '%s\\n' "$*" >> "$GIT_LOG"
if [ "$1 $2" = "rev-parse --git-dir" ]; then
  [ "\${FAKE_GIT_REPOSITORY:-1}" = "1" ] && printf '.git\\n' && exit 0
  exit 128
fi
exit 0
`)
  chmodSync(fakeGit, 0o755)
  return root
}

function runInstaller(root, environment = {}) {
  return spawnSync('bun', [installer, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...environment,
      GIT_LOG: join(root, 'git.log'),
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    },
  })
}
