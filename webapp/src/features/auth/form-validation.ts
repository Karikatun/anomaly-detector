import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileSchema,
} from '@anomaly-detector/contracts'

export type CredentialsFormValues = {
  ageConfirmation: boolean
  displayName: string
  login: string
  password: string
  privacyConsent: boolean
}

export function parseCredentialsForm(
  mode: 'login' | 'register',
  values: CredentialsFormValues,
) {
  if (mode === 'login') {
    return loginRequestSchema.safeParse({
      login: values.login,
      password: values.password,
    })
  }

  return registerRequestSchema.safeParse(values)
}

export function parseProfileForm(values: { displayName: string }) {
  return updateProfileSchema.safeParse(values)
}
