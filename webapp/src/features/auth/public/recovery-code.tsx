import { Link } from '@tanstack/react-router'
import { useMemo, useState, type FormEvent } from 'react'
import {
  recoveryCodeEmailReplacementConfirmRequestSchema,
  recoveryCodeEmailReplacementStartRequestSchema,
  recoveryCodePasswordRequestSchema,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

import { RecoveryCodeApi } from '../recovery-code-api'
import styles from './RecoveryCodePage.module.css'

type RecoveryMode = 'email' | 'password'

export function RecoveryCodeRoute() {
  const { t } = useI18n()
  const api = useMemo(() => new RecoveryCodeApi(), [])
  const [mode, setMode] = useState<RecoveryMode>('password')
  const [login, setLogin] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailStep, setEmailStep] = useState<'confirm' | 'start'>('start')
  const [pendingEmail, setPendingEmail] = useState<{
    codeExpiresAt: string
    maskedAccountEmail: string
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [result, setResult] = useState<{ kind: 'accepted' | 'completed'; text: string } | null>(null)

  const resetResult = () => {
    setResult(null)
    setValidationError(null)
  }

  const changeMode = (nextMode: RecoveryMode) => {
    setMode(nextMode)
    setRecoveryCode('')
    setNewPassword('')
    setNewEmail('')
    setEmailCode('')
    setEmailStep('start')
    setPendingEmail(null)
    resetResult()
  }

  const recoverPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetResult()
    const parsed = recoveryCodePasswordRequestSchema.safeParse({
      login,
      newPassword,
      recoveryCode,
    })
    if (!parsed.success) {
      setValidationError(t('auth.recoveryCode.validation'))
      return
    }
    setIsSubmitting(true)
    try {
      const response = await api.recoverPassword(parsed.data)
      setResult({
        kind: response.outcome,
        text: t(response.outcome === 'completed'
          ? 'auth.recoveryCode.password.completed'
          : 'auth.recoveryCode.password.accepted'),
      })
    } catch {
      setResult({ kind: 'accepted', text: t('auth.recoveryCode.password.accepted') })
    } finally {
      setRecoveryCode('')
      setNewPassword('')
      setIsSubmitting(false)
    }
  }

  const startEmailReplacement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetResult()
    const parsed = recoveryCodeEmailReplacementStartRequestSchema.safeParse({
      email: newEmail,
      login,
      recoveryCode,
    })
    if (!parsed.success) {
      setValidationError(t('auth.recoveryCode.validation'))
      return
    }
    setIsSubmitting(true)
    try {
      const response = await api.startRecoveryEmailReplacement(parsed.data)
      if (response.outcome === 'pending') {
        setPendingEmail(response)
        setEmailStep('confirm')
        setResult(null)
      } else {
        setResult({ kind: 'accepted', text: t('auth.recoveryCode.email.accepted') })
      }
    } catch {
      setResult({ kind: 'accepted', text: t('auth.recoveryCode.email.accepted') })
    } finally {
      setRecoveryCode('')
      setIsSubmitting(false)
    }
  }

  const confirmEmailReplacement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetResult()
    const parsed = recoveryCodeEmailReplacementConfirmRequestSchema.safeParse({
      code: emailCode,
      login,
    })
    if (!parsed.success) {
      setValidationError(t('auth.recoveryCode.email.codeValidation'))
      return
    }
    setIsSubmitting(true)
    try {
      const response = await api.confirmRecoveryEmailReplacement(parsed.data)
      setResult({
        kind: response.outcome,
        text: response.outcome === 'completed'
          ? t('auth.recoveryCode.email.completed', {
              activates: formatRecoveryTime(response.activatesAt),
              email: response.maskedAccountEmail,
            })
          : t('auth.recoveryCode.email.accepted'),
      })
      if (response.outcome === 'completed') {
        setEmailStep('start')
        setPendingEmail(null)
        setNewEmail('')
      }
    } catch {
      setResult({ kind: 'accepted', text: t('auth.recoveryCode.email.accepted') })
    } finally {
      setEmailCode('')
      setIsSubmitting(false)
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.background} aria-hidden="true" />
      <section className={styles.panel} aria-labelledby="recovery-code-title">
        <header className={styles.header}>
          <Typography as="span" className={styles.wordmark}>{t('app.logo')}</Typography>
          <Typography as="h1" id="recovery-code-title" className={styles.title}>
            {t('auth.recoveryCode.title')}
          </Typography>
          <Typography className={styles.description}>
            {t('auth.recoveryCode.description')}
          </Typography>
        </header>

        <div className={styles.modeTabs} role="tablist" aria-label={t('auth.recoveryCode.modeLabel')}>
          <Button
            id="recovery-code-password-tab"
            type="button"
            role="tab"
            aria-controls="recovery-code-password-panel"
            aria-selected={mode === 'password'}
            variant={mode === 'password' ? 'default' : 'ghost'}
            onClick={() => changeMode('password')}
          >
            {t('auth.recoveryCode.password.tab')}
          </Button>
          <Button
            id="recovery-code-email-tab"
            type="button"
            role="tab"
            aria-controls="recovery-code-email-panel"
            aria-selected={mode === 'email'}
            variant={mode === 'email' ? 'default' : 'ghost'}
            onClick={() => changeMode('email')}
          >
            {t('auth.recoveryCode.email.tab')}
          </Button>
        </div>

        {mode === 'password' ? (
          <form
            id="recovery-code-password-panel"
            role="tabpanel"
            aria-labelledby="recovery-code-password-tab"
            className={styles.form}
            onSubmit={(event) => void recoverPassword(event)}
          >
            <RecoveryIdentityFields
              login={login}
              recoveryCode={recoveryCode}
              onLoginChange={(value) => { setLogin(value); resetResult() }}
              onRecoveryCodeChange={(value) => { setRecoveryCode(value); resetResult() }}
            />
            <label className={styles.field} htmlFor="recovery-new-password">
              <Typography as="span">{t('auth.recoveryCode.password.newPassword')}</Typography>
              <Input
                id="recovery-new-password"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => { setNewPassword(event.target.value); resetResult() }}
              />
            </label>
            <RecoveryResult error={validationError} result={result} />
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting
                ? t('auth.recoveryCode.submitting')
                : t('auth.recoveryCode.password.submit')}
            </Button>
          </form>
        ) : emailStep === 'start' ? (
          <form
            id="recovery-code-email-panel"
            role="tabpanel"
            aria-labelledby="recovery-code-email-tab"
            className={styles.form}
            onSubmit={(event) => void startEmailReplacement(event)}
          >
            <RecoveryIdentityFields
              login={login}
              recoveryCode={recoveryCode}
              onLoginChange={(value) => { setLogin(value); resetResult() }}
              onRecoveryCodeChange={(value) => { setRecoveryCode(value); resetResult() }}
            />
            <label className={styles.field} htmlFor="recovery-new-email">
              <Typography as="span">{t('auth.recoveryCode.email.newEmail')}</Typography>
              <Input
                id="recovery-new-email"
                type="email"
                maxLength={254}
                autoComplete="email"
                required
                value={newEmail}
                onChange={(event) => { setNewEmail(event.target.value); resetResult() }}
              />
            </label>
            <RecoveryResult error={validationError} result={result} />
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting
                ? t('auth.recoveryCode.submitting')
                : t('auth.recoveryCode.email.submit')}
            </Button>
          </form>
        ) : (
          <form
            id="recovery-code-email-panel"
            role="tabpanel"
            aria-labelledby="recovery-code-email-tab"
            className={styles.form}
            onSubmit={(event) => void confirmEmailReplacement(event)}
          >
            <Typography className={styles.pendingNotice}>
              {t('auth.recoveryCode.email.pending', {
                email: pendingEmail?.maskedAccountEmail ?? '',
                expires: pendingEmail ? formatRecoveryTime(pendingEmail.codeExpiresAt) : '',
              })}
            </Typography>
            <label className={styles.field} htmlFor="recovery-email-code">
              <Typography as="span">{t('auth.recoveryCode.email.code')}</Typography>
              <Input
                autoFocus
                id="recovery-email-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={emailCode}
                onChange={(event) => {
                  setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  resetResult()
                }}
              />
            </label>
            <RecoveryResult error={validationError} result={result} />
            <div className={styles.actions}>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setEmailStep('start')
                  setPendingEmail(null)
                  setEmailCode('')
                  resetResult()
                }}
              >
                {t('auth.recoveryCode.email.restart')}
              </Button>
              <Button type="submit" disabled={isSubmitting || emailCode.length !== 6}>
                {isSubmitting
                  ? t('auth.recoveryCode.submitting')
                  : t('auth.recoveryCode.email.confirm')}
              </Button>
            </div>
          </form>
        )}

        <footer className={styles.footer}>
          <Link to="/">{t('auth.recoveryCode.back')}</Link>
        </footer>
      </section>
    </main>
  )
}

function RecoveryIdentityFields({
  login,
  onLoginChange,
  onRecoveryCodeChange,
  recoveryCode,
}: {
  login: string
  onLoginChange: (value: string) => void
  onRecoveryCodeChange: (value: string) => void
  recoveryCode: string
}) {
  const { t } = useI18n()
  return (
    <>
      <label className={styles.field} htmlFor="recovery-login">
        <Typography as="span">{t('auth.loginName')}</Typography>
        <Input
          id="recovery-login"
          type="text"
          autoComplete="username"
          required
          value={login}
          onChange={(event) => onLoginChange(event.target.value)}
        />
      </label>
      <label className={styles.field} htmlFor="user-held-recovery-code">
        <Typography as="span">{t('auth.recoveryCode.codeLabel')}</Typography>
        <Input
          id="user-held-recovery-code"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={48}
          required
          value={recoveryCode}
          onChange={(event) => onRecoveryCodeChange(event.target.value.toUpperCase())}
        />
      </label>
    </>
  )
}

function RecoveryResult({
  error,
  result,
}: {
  error: string | null
  result: { kind: 'accepted' | 'completed'; text: string } | null
}) {
  if (error) return <Typography role="alert" className={styles.error}>{error}</Typography>
  if (!result) return null
  return (
    <Typography
      role="status"
      className={styles.result}
      data-outcome={result.kind}
    >
      {result.text}
    </Typography>
  )
}

function formatRecoveryTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}
