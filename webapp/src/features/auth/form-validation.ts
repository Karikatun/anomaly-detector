import {
  loginRequestSchema,
  personalDataConsentVersion,
  registerRequestSchema,
  termsVersion,
  updateProfileSchema,
} from '@anomaly-detector/contracts'

export type CredentialsFormValues = {
  displayName: string
  login: string
  password: string
  privacyConsent: boolean
  privacyConsentVersion: typeof personalDataConsentVersion
  termsAccepted: boolean
  termsVersion: typeof termsVersion
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
