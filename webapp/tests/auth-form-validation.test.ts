import { expect, test } from 'bun:test'

import {
  parseCredentialsForm,
  parseProfileForm,
} from '../src/features/auth/form-validation'

const registration = {
  displayName: 'Игрок',
  login: 'player-one',
  password: 'password123',
  privacyConsent: true,
  privacyConsentVersion: '1.0',
  termsVersion: '1.0',} as const

test('registration uses the shared display-name boundaries', () => {
  expect(parseCredentialsForm('register', { ...registration, displayName: 'Я' }).success).toBe(false)
  expect(parseCredentialsForm('register', { ...registration, displayName: 'Ян' }).success).toBe(true)
  expect(parseCredentialsForm('register', { ...registration, displayName: 'Я'.repeat(20) }).success).toBe(true)
  expect(parseCredentialsForm('register', { ...registration, displayName: 'Я'.repeat(21) }).success).toBe(false)
})

test('profile editing uses the shared display-name boundaries', () => {
  expect(parseProfileForm({ displayName: 'Я' }).success).toBe(false)
  expect(parseProfileForm({ displayName: 'Ян' }).success).toBe(true)
  expect(parseProfileForm({ displayName: 'Я'.repeat(20) }).success).toBe(true)
  expect(parseProfileForm({ displayName: 'Я'.repeat(21) }).success).toBe(false)
})
