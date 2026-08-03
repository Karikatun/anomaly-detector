import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = parseRoot(process.argv.slice(2))
const hooks = ['commit-msg', 'pre-commit', 'pre-push']

for (const hook of hooks) {
  if (!existsSync(join(root, '.githooks', hook))) fail(`Missing Git hook: .githooks/${hook}`)
}

const repository = spawnSync('git', ['rev-parse', '--git-dir'], {
  cwd: root,
  encoding: 'utf8',
})

if (repository.status !== 0) {
  process.stdout.write('Git repository not found; hooks were not installed. Run "bun run hooks:install" after git init.\n')
  process.exit(0)
}

const configuration = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: root,
  encoding: 'utf8',
})

if (configuration.status !== 0) fail(configuration.stderr.trim() || 'Could not configure core.hooksPath')
process.stdout.write('Git hooks installed from .githooks.\n')

function parseRoot(argv) {
  if (argv.length === 0) return resolve(import.meta.dirname, '..')
  if (argv.length === 2 && argv[0] === '--root') return resolve(argv[1])
  fail('Usage: bun scripts/install-git-hooks.mjs [--root <repository>]')
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
