import { describe, expect, test } from 'bun:test'

import { validateCommitMessage } from './validate-commit-message.mjs'

describe('Conventional Commit validation', () => {
  test('accepts repository commit styles and breaking changes', () => {
    for (const message of [
      'feat(tender): add recovery notice',
      'fix: prevent duplicate action',
      'docs: clarify deployment flow',
      'feat(contracts)!: change session response',
      'Merge branch \'master\' into release',
      'Revert "feat(tender): add recovery notice"',
    ]) {
      expect(validateCommitMessage(message)).toEqual({ valid: true })
    }
  })

  test('rejects missing type, uppercase subjects, and trailing periods', () => {
    for (const message of [
      'update tender flow',
      'feat(tender): Add recovery notice',
      'fix(auth): prevent duplicate login.',
      'feature(auth): add recovery',
    ]) {
      expect(validateCommitMessage(message).valid).toBe(false)
    }
  })
})
