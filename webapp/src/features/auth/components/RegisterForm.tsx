import { useForm } from '@tanstack/react-form'
import { registerRequestSchema, type RegisterRequest } from '@anomaly-detector/contracts'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiRequestError } from '@/platform/api'
import { useI18n } from '@/platform/i18n'
import { useAuth } from '../use-auth'
import { FormAlert } from './form-errors'
import type { AuthDraft, FieldErrors } from './form-model'
import { clearFieldError, errorId, hasErrors, toFieldErrors } from './form-validation'

export function RegisterForm({
  draft,
  onDraftChange,
}: {
  draft: AuthDraft
  onDraftChange: (draft: Partial<AuthDraft>) => void
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const displayNameId = useId()
  const displayNameErrorId = useId()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: draft,
    onSubmit: async ({ value }) => {
      setFormError(null)
      const merged = { ...value, privacyConsent: draft.privacyConsent, ageConfirmation: draft.ageConfirmation }
      const result = registerRequestSchema.safeParse(merged)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})
      try {
        await auth.register(result.data as RegisterRequest)
      } catch (caughtError) {
        setFormError(
          caughtError instanceof ApiRequestError ? caughtError.message : t('register.error.unexpected'),
        )
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="displayName"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.displayName)}>
              <FieldLabel htmlFor={displayNameId}>{t('register.displayName')}</FieldLabel>
              <Input
                id={displayNameId}
                name={field.name}
                value={field.state.value ?? ''}
                autoComplete="name"
                placeholder={t('register.displayName.placeholder')}
                aria-invalid={hasErrors(fieldErrors.displayName)}
                aria-describedby={errorId(fieldErrors.displayName, displayNameErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ displayName: value })
                  clearFieldError('displayName', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={displayNameErrorId} errors={fieldErrors.displayName} />
            </Field>
          )}
        />

        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>{t('register.email')}</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder={t('register.email.placeholder')}
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ email: value })
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>{t('register.password')}</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="new-password"
                placeholder={t('register.password.placeholder')}
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ password: value })
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.privacyConsent}
            onChange={(event) => {
              onDraftChange({ privacyConsent: event.target.checked })
              clearFieldError('privacyConsent', setFieldErrors)
            }}
            className="mt-1"
          />
          <span>{t('register.privacyConsent')}</span>
        </label>
        <FieldError errors={fieldErrors.privacyConsent} />

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.ageConfirmation}
            onChange={(event) => {
              onDraftChange({ ageConfirmation: event.target.checked })
              clearFieldError('ageConfirmation', setFieldErrors)
            }}
            className="mt-1"
          />
          <span>{t('register.ageConfirmation')}</span>
        </label>
        <FieldError errors={fieldErrors.ageConfirmation} />

        <FormAlert message={formError} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('register.submitting') : t('register.submit')}
            </Button>
          )}
        />
      </FieldGroup>
    </form>
  )
}