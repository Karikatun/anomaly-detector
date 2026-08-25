import { expect, test } from 'bun:test'

import {
  passwordRecoveryRecipient,
  shouldEnsurePasswordRecoveryMailPolicy,
} from '../e2e/password-recovery-isolation'

test('scopes password-recovery mail to the registered test account', () => {
  expect(passwordRecoveryRecipient('alpha-player')).toBe('alpha-player@mail.ru')
  expect(passwordRecoveryRecipient('beta-player')).toBe('beta-player@mail.ru')
})

test('seeds password-recovery policy only for the main browser suite', () => {
  expect(shouldEnsurePasswordRecoveryMailPolicy({})).toBe(true)
  expect(shouldEnsurePasswordRecoveryMailPolicy({ E2E_SPLIT_DOMAIN_MODE: 'target' })).toBe(false)
  expect(shouldEnsurePasswordRecoveryMailPolicy({ E2E_SPLIT_DOMAIN_MODE: 'rollback' })).toBe(false)
})
