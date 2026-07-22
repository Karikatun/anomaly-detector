import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

export function LoginForm() {
  const { t } = useI18n()
  const auth = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loginError = login.length > 0 && !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(login)
  const passwordError = password.length > 0 && password.length < 8
  const displayNameError = mode === 'register' && displayName.length > 0 && displayName.trim().length === 0

  const isValid =
    /^[a-z0-9][a-z0-9_-]{2,63}$/i.test(login) &&
    password.length >= 8 &&
    (mode === 'login' || displayName.trim().length >= 1)

  const handleSubmit = async () => {
    if (!isValid) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') {
        await auth.register({
          login: login.trim(),
          password,
          displayName: displayName.trim(),
          privacyConsent: true,
          ageConfirmation: true,
        })
      } else {
        await auth.login({ login: login.trim(), password })
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(mode === 'register' ? 'auth.errors.registerFailed' : 'auth.errors.loginFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="auth-login">{t('auth.loginName')}</FieldLabel>
          <Input
            id="auth-login"
            type="text"
            autoComplete="username"
            value={login}
            placeholder="player_1"
            onChange={(e) => { setLogin(e.target.value); setError(null) }}
          />
          {loginError && <FieldError id="auth-login-error" errors={[{ message: t('auth.errors.loginName') }]} />}
        </Field>

        <Field>
          <FieldLabel htmlFor="auth-password">{t('auth.password')}</FieldLabel>
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit() }}
          />
          {passwordError && <FieldError id="auth-password-error" errors={[{ message: t('auth.errors.password') }]} />}
        </Field>

        {mode === 'register' && (
          <Field>
            <FieldLabel htmlFor="auth-display-name">{t('auth.displayName')}</FieldLabel>
            <Input
              id="auth-display-name"
              type="text"
              autoComplete="name"
              value={displayName}
              placeholder="Игрок 1"
              onChange={(e) => { setDisplayName(e.target.value); setError(null) }}
            />
            {displayNameError && <FieldError id="auth-name-error" errors={[{ message: t('auth.errors.displayName') }]} />}
          </Field>
        )}

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive">
            {error}
          </Typography>
        )}

        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!isValid || busy}
          onClick={() => void handleSubmit()}
        >
          {busy
            ? mode === 'register'
              ? 'Регистрируем...'
              : 'Входим...'
            : mode === 'register'
              ? t('auth.register')
              : t('auth.login')}
        </Button>
      </FieldGroup>

      <Separator />

      <Button
        variant="link"
        size="sm"
        className="w-full"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
      >
        {mode === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
      </Button>
    </div>
  )
}
