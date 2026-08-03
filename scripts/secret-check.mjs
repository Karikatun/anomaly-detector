import { sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const ignoredDirectories = new Set([
  '.astro', '.git', '.scratch', 'coverage', 'dist', 'generated', 'node_modules',
  'playwright-report', 'test-results',
])
const contentPatterns = [
  { kind: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { kind: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { kind: 'OpenAI API key', pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/ },
  { kind: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { kind: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
]

export function findSecretViolations(files) {
  const violations = []

  for (const file of files) {
    const path = normalize(file.path)
    if (isIgnored(path)) continue

    const forbiddenName = forbiddenFileKind(path)
    if (forbiddenName) violations.push({ kind: forbiddenName, path })

    for (const candidate of contentPatterns) {
      if (candidate.pattern.test(file.source)) violations.push({ kind: candidate.kind, path })
    }
  }

  return violations.sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind))
}

function forbiddenFileKind(path) {
  const isEnvironmentFile = /(?:^|\/)\.env(?:\.[^/]+)*$/.test(path)
  const isEnvironmentExample = /\.env(?:\.[^/]+)*\.example$/.test(path)
  if (isEnvironmentFile && !isEnvironmentExample) return 'environment file'
  if (/\.(?:key|p12|pem|pfx)$/.test(path) || /(?:^|\/)(?:id_rsa|id_ed25519)$/.test(path)) {
    return 'credential file'
  }
  return undefined
}

function indexFiles(root, mode) {
  const listArgs = mode === 'staged'
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '-z']
  const listed = git(root, listArgs)
  if (listed.status !== 0) throw new Error(listed.stderr.trim() || 'Could not read Git index')

  const paths = listed.stdout.split('\0').filter(Boolean)
  const files = []
  for (const path of paths) {
    const blob = git(root, ['show', `:${path}`])
    const source = blob.status === 0 && !blob.stdout.includes('\0') ? blob.stdout : ''
    files.push({ path, source })
  }
  return files
}

function git(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

function isIgnored(path) {
  return path.split('/').some((part) => ignoredDirectories.has(part))
}

function normalize(path) {
  return path.split(sep).join('/')
}

function parseArguments(argv) {
  let root = process.cwd()
  let mode = 'tracked'

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('Missing value for --root')
      root = value
      index += 1
    } else if (argument === '--tracked') mode = 'tracked'
    else if (argument === '--staged') mode = 'staged'
    else throw new Error(`Unexpected argument: ${argument}`)
  }
  return { mode, root }
}

if (import.meta.main) {
  try {
    const { mode, root } = parseArguments(process.argv.slice(2))
    const violations = findSecretViolations(indexFiles(root, mode))
    if (violations.length > 0) {
      for (const violation of violations) {
        console.error(`${violation.path}: possible ${violation.kind}`)
      }
      process.exit(1)
    }
    console.log(`Secret hygiene (${mode} files): OK`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
