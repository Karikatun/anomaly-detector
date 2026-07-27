import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useForm } from '@tanstack/react-form'
import {
  loginSchema,
  loginRequestSchema,
  personalDataConsentVersion,
  passwordSchema,
  registerRequestSchema,
  termsVersion,
} from '@anomaly-detector/contracts'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { ApiRequestError } from '@/platform/api'
import {
  parseCredentialsForm,
  type CredentialsFormValues,
} from '../form-validation'
import { useAuth } from '../use-auth'
import styles from './AuthForm.module.css'
import { OAuthButton } from './OAuthButton'

export function LoginForm({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n()
  const auth = useAuth()
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consentReminder, setConsentReminder] = useState(false)
  const form = useForm({
    defaultValues: {
      displayName: '',
      login: '',
      password: '',
      privacyConsent: false as boolean,
      privacyConsentVersion: personalDataConsentVersion,
      termsVersion,
    } satisfies CredentialsFormValues,
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        if (mode === 'register') {
          const parsed = registerRequestSchema.safeParse(value)
          if (!parsed.success) return
          await auth.register(parsed.data)
        } else {
          const parsed = loginRequestSchema.safeParse(value)
          if (!parsed.success) return
          await auth.login(parsed.data)
        }
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'RATE_LIMITED') {
          setError(t(mode === 'register'
            ? 'auth.errors.registrationLimited'
            : 'auth.errors.loginLimited'))
        } else {
          setError(
            err instanceof Error
              ? err.message
              : t(mode === 'register' ? 'auth.errors.registerFailed' : 'auth.errors.loginFailed'),
          )
        }
      }
    },
  })

  return (
    <div className={styles.credentials}>
      <form.Subscribe selector={(state) => state.values.privacyConsent}>
        {(privacyConsent) => (
          <OAuthButton
            provider="yandex"
            label={t('oauth.yandex')}
            className={styles.yandexButton}
            icon={(
              <img
                src="/assets/auth/yandex-logo.svg"
                className={styles.yandexLogo}
                alt=""
                aria-hidden="true"
              />
            )}
            registration={mode === 'register' && privacyConsent ? {
              privacyConsent: true,
              privacyConsentVersion: personalDataConsentVersion,
              termsVersion,
            } : undefined}
            requireRegistrationConsent={mode === 'register'}
            onConsentRequired={() => {
              setConsentReminder(true)
              document.getElementById('auth-privacy-consent')?.focus()
            }}
          />
        )}
      </form.Subscribe>
      <Typography as="div" variant="control" className={styles.separator}>ИЛИ</Typography>
      <Typography as="p" className={styles.credentialsTitle}>
        {mode === 'register' ? t('auth.register') : 'ВОЙТИ ЧЕРЕЗ ЛОГИН И ПАРОЛЬ'}
      </Typography>
      <FieldGroup className={styles.fields}>
        <form.Field name="login">
          {(field) => {
            const loginError = field.state.value.length > 0 && !loginSchema.safeParse(field.state.value).success
            return (
              <Field className={styles.field}>
                <FieldLabel className={styles.fieldLabel} htmlFor="auth-login">{t('auth.loginName')}</FieldLabel>
                <Input
                  id="auth-login"
                  type="text"
                  autoComplete="username"
                  value={field.state.value}
                  className={styles.input}
                  placeholder="Логин"
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    setError(null)
                  }}
                />
                <div className={styles.fieldErrorSlot}>
                  {loginError && <FieldError id="auth-login-error" errors={[{ message: t('auth.errors.loginName') }]} />}
                </div>
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="password">
          {(field) => {
            const passwordError = field.state.value.length > 0 && !passwordSchema.safeParse(field.state.value).success
            return (
              <Field className={styles.field}>
                <FieldLabel className={styles.fieldLabel} htmlFor="auth-password">{t('auth.password')}</FieldLabel>
                <div className={styles.passwordControl}>
                  <Input
                    id="auth-password"
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={field.state.value}
                    className={`${styles.input} ${styles.passwordInput}`}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void form.handleSubmit()
                    }}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    aria-controls="auth-password"
                    aria-label={t(passwordVisible ? 'auth.password.hide' : 'auth.password.show')}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    <HugeiconsIcon
                      icon={passwordVisible ? ViewIcon : ViewOffIcon}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </button>
                </div>
                <div className={styles.fieldErrorSlot}>
                  {passwordError && <FieldError id="auth-password-error" errors={[{ message: t('auth.errors.password') }]} />}
                </div>
              </Field>
            )
          }}
        </form.Field>

        {mode === 'register' && (
          <>
            <form.Field name="displayName">
              {(field) => {
                const displayNameError = field.state.value.length > 0
                  && !registerRequestSchema.shape.displayName.safeParse(field.state.value).success
                return (
                  <Field className={styles.field}>
                    <FieldLabel className={styles.fieldLabel} htmlFor="auth-display-name">{t('auth.displayName')}</FieldLabel>
                    <Input
                      id="auth-display-name"
                      type="text"
                      autoComplete="name"
                      value={field.state.value}
                      className={styles.input}
                      placeholder="Игрок 1"
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.target.value)
                        setError(null)
                      }}
                    />
                    <div className={styles.fieldErrorSlot}>
                      {displayNameError && <FieldError id="auth-name-error" errors={[{ message: t('auth.errors.displayName') }]} />}
                    </div>
                  </Field>
                )
              }}
            </form.Field>

            <div className={styles.consents}>
              <Typography variant="bodyXs" className={styles.ageNotice}>
                {t('auth.ageNotice')}
              </Typography>
              <form.Field name="privacyConsent">
                {(field) => (
                  <div className={styles.consent}>
                    <Checkbox
                      id="auth-privacy-consent"
                      checked={field.state.value}
                      onCheckedChange={(checked) => {
                        field.handleChange(checked === true)
                        setConsentReminder(false)
                      }}
                    />
                    <Label htmlFor="auth-privacy-consent">
                      Я даю согласие на{' '}
                      <Link
                        className={styles.inlineLegalLink}
                        to="/personal-data-consent"
                        target="_blank"
                      >
                        обработку персональных данных
                      </Link>
                    </Label>
                  </div>
                )}
              </form.Field>
              {consentReminder && (
                <Typography role="alert" variant="bodyXs" tone="destructive">
                  Отметьте согласие на обработку персональных данных, чтобы продолжить через Яндекс.
                </Typography>
              )}
              <Typography variant="bodyXs" className={styles.termsNotice}>
                Нажимая «Регистрация», вы принимаете{' '}
                <Link className={styles.inlineLegalLink} to="/terms" target="_blank">
                  Пользовательское соглашение
                </Link>
                .
              </Typography>
            </div>
          </>
        )}

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive">
            {error}
          </Typography>
        )}

        <form.Subscribe selector={(state) => [state.values, state.isSubmitting] as const}>
          {([values, isSubmitting]) => {
            const isValid = parseCredentialsForm(mode, values).success
            return (
              <Button
                type="button"
                size="lg"
                className={styles.submit}
                disabled={!isValid || isSubmitting}
                onClick={() => void form.handleSubmit()}
              >
                {isSubmitting
                  ? mode === 'register'
                    ? 'Регистрируем...'
                    : 'Входим...'
                  : mode === 'register'
                    ? t('auth.register')
                    : t('auth.login')}
              </Button>
            )
          }}
        </form.Subscribe>
      </FieldGroup>
    </div>
  )
}
