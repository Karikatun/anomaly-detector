import { readFileSync } from 'node:fs'

const conventionalCommit = /^(?:feat|fix|docs|test|refactor|perf|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9-]*\))?!?: [a-z0-9](?:.*[^.\s])?$/
const generatedCommit = /^(?:Merge |Revert "|fixup! |squash! )/

export function validateCommitMessage(message) {
  const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (generatedCommit.test(subject) || conventionalCommit.test(subject)) return { valid: true }
  return {
    valid: false,
    message: 'Use Conventional Commits: type(scope): lowercase imperative subject without a trailing period.',
  }
}

if (import.meta.main) {
  const messagePath = process.argv[2]
  if (!messagePath) {
    console.error('Usage: bun scripts/validate-commit-message.mjs <commit-message-file>')
    process.exit(1)
  }
  const result = validateCommitMessage(readFileSync(messagePath, 'utf8'))
  if (!result.valid) {
    console.error(`commit-msg: ${result.message}`)
    console.error('Examples: feat(tender): add recovery notice | fix(auth): reject replay | docs: clarify deployment')
    process.exit(1)
  }
}
