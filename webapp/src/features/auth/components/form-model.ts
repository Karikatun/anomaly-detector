export type AuthMode = 'login' | 'register'
export type FieldName = 'displayName' | 'email' | 'password' | 'privacyConsent' | 'ageConfirmation'
export type FormError = { message?: string }
export type FieldErrors = Partial<Record<FieldName, FormError[]>>
export type AuthDraft = {
  email: string
  password: string
  displayName: string
  privacyConsent: boolean
  ageConfirmation: boolean
}

export const emptyDraft: AuthDraft = {
  email: '',
  password: '',
  displayName: '',
  privacyConsent: false,
  ageConfirmation: false,
}
