import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useForm } from '@tanstack/react-form'
import {
  loginSchema,
  loginRequestSchema,
  passwordSchema,
  registerRequestSchema,
} from '@anomaly-detector/contracts'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  parseCredentialsForm,
  type CredentialsFormValues,
} from '../form-validation'
import { useAuth } from '../use-auth'
import styles from './AuthForm.module.css'

export function LoginForm() {
  const { t } = useI18n()
  const auth = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: {
      ageConfirmation: false as boolean,
      displayName: '',
      login: '',
      password: '',
      privacyConsent: false as boolean,
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
        setError(
          err instanceof Error
            ? err.message
            : t(mode === 'register' ? 'auth.errors.registerFailed' : 'auth.errors.loginFailed'),
        )
      }
    },
  })

  return (
    <div className={styles.credentials}>
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
                {loginError && <FieldError id="auth-login-error" errors={[{ message: t('auth.errors.loginName') }]} />}
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
                {passwordError && <FieldError id="auth-password-error" errors={[{ message: t('auth.errors.password') }]} />}
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
                    {displayNameError && <FieldError id="auth-name-error" errors={[{ message: t('auth.errors.displayName') }]} />}
                  </Field>
                )
              }}
            </form.Field>

            <div className={styles.consents}>
              <form.Field name="privacyConsent">
                {(field) => (
                  <div className={styles.consent}>
                    <Checkbox
                      id="auth-privacy-consent"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked === true)}
                    />
                    <Label htmlFor="auth-privacy-consent">{t('auth.privacyConsent')}</Label>
                  </div>
                )}
              </form.Field>
              <form.Field name="ageConfirmation">
                {(field) => (
                  <div className={styles.consent}>
                    <Checkbox
                      id="auth-age-confirmation"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked === true)}
                    />
                    <Label htmlFor="auth-age-confirmation">{t('auth.ageConfirmation')}</Label>
                  </div>
                )}
              </form.Field>
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

      <div className={styles.switchPanel}>
        <Typography as="span" className={styles.switchCopy}>
          {mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
        </Typography>
        <Button
          variant="ghost"
          size="sm"
          className={styles.switchButton}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setPasswordVisible(false)
            setError(null)
            form.reset()
          }}
        >
          {mode === 'login' ? t('auth.register') : t('auth.login')}
        </Button>
      </div>
    </div>
  )
}
