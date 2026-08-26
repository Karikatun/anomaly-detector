import {
  completePasswordResetRequestSchema,
  requestPasswordResetRequestSchema,
} from '@anomaly-detector/contracts'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/platform/api'
import { useI18n } from '@/platform/i18n'

import { PasswordRecoveryApi } from '../password-recovery-api'
import styles from './RecoveryCodePage.module.css'

type InitialFlow =
  | { kind: 'invalid' | 'request' }
  | { kind: 'reset'; token: string }

type RequestState = 'accepted' | 'error' | 'idle' | 'submitting'
type ResetState = 'completed' | 'error' | 'ready' | 'submitting' | 'unavailable'

export function PasswordRecoveryRoute() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const api = useMemo(() => new PasswordRecoveryApi(), [])
  const [flow, setFlow] = useState<InitialFlow>(readInitialFlow)
  const [login, setLogin] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [requestState, setRequestState] = useState<RequestState>('idle')
  const [resetState, setResetState] = useState<ResetState>('ready')
  const [validationError, setValidationError] = useState<string | null>(null)
  const resultHeadingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const consumeFragment = () => {
      if (!window.location.hash) return
      setFlow(readInitialFlow())
      void navigate({ to: '/recover/password', hash: '', replace: true })
    }
    consumeFragment()
    window.addEventListener('hashchange', consumeFragment)
    return () => window.removeEventListener('hashchange', consumeFragment)
  }, [navigate])

  useEffect(() => {
    if (requestState === 'accepted' || resetState === 'completed' || resetState === 'unavailable') {
      resultHeadingRef.current?.focus()
    }
  }, [requestState, resetState])

  const requestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
    const parsed = requestPasswordResetRequestSchema.safeParse({ login })
    if (!parsed.success) {
      setValidationError(t('auth.errors.loginName'))
      return
    }
    setRequestState('submitting')
    try {
      await api.requestReset(parsed.data)
      setLogin('')
      setRequestState('accepted')
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 429) {
        setLogin('')
        setRequestState('accepted')
      } else {
        setRequestState('error')
      }
    }
  }

  const completeReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
    if (flow.kind !== 'reset') return
    if (newPassword !== confirmPassword) {
      setValidationError(t('auth.passwordRecovery.passwordMismatch'))
      return
    }
    const parsed = completePasswordResetRequestSchema.safeParse({
      newPassword,
      token: flow.token,
    })
    if (!parsed.success) {
      setValidationError(t('auth.errors.password'))
      return
    }
    setResetState('submitting')
    try {
      const response = await api.completeReset(parsed.data)
      setNewPassword('')
      setConfirmPassword('')
      setFlow({ kind: 'invalid' })
      setResetState(response.outcome === 'completed' ? 'completed' : 'unavailable')
    } catch {
      setResetState('error')
    }
  }

  const startNewRequest = () => {
    setFlow({ kind: 'request' })
    setRequestState('idle')
    setResetState('ready')
    setValidationError(null)
    setNewPassword('')
    setConfirmPassword('')
  }

  const showsRequest = flow.kind === 'request'
  const showsInvalid = flow.kind === 'invalid'
    && resetState !== 'completed'
    && resetState !== 'unavailable'

  return (
    <div className={styles.screen}>
      <div className={styles.background} aria-hidden="true" />
      <section className={styles.panel} aria-labelledby="password-recovery-title">
        <header className={styles.header}>
          <Typography as="span" className={styles.wordmark}>{t('app.logo')}</Typography>
          <Typography as="h1" id="password-recovery-title" className={styles.title}>
            {t(showsRequest
              ? 'auth.passwordRecovery.request.title'
              : 'auth.passwordRecovery.reset.title')}
          </Typography>
          <Typography className={styles.description}>
            {t(showsRequest
              ? 'auth.passwordRecovery.request.description'
              : 'auth.passwordRecovery.reset.description')}
          </Typography>
        </header>

        {showsRequest && requestState !== 'accepted' && (
          <form className={styles.form} noValidate onSubmit={(event) => void requestReset(event)}>
            <label className={styles.field} htmlFor="password-recovery-login">
              <Typography as="span">{t('auth.loginName')}</Typography>
              <Input
                id="password-recovery-login"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={login}
                aria-invalid={validationError ? true : undefined}
                aria-describedby={validationError ? 'password-recovery-error' : undefined}
                onChange={(event) => {
                  setLogin(event.target.value)
                  setValidationError(null)
                  setRequestState('idle')
                }}
              />
            </label>
            {validationError && (
              <Typography
                id="password-recovery-error"
                role="alert"
                className={styles.error}
              >
                {validationError}
              </Typography>
            )}
            {requestState === 'error' && (
              <Typography role="alert" className={styles.error}>
                {t('auth.passwordRecovery.networkError')}
              </Typography>
            )}
            <Button type="submit" size="lg" disabled={requestState === 'submitting'}>
              {t(requestState === 'submitting'
                ? 'auth.passwordRecovery.request.submitting'
                : 'auth.passwordRecovery.request.submit')}
            </Button>
          </form>
        )}

        {showsRequest && requestState === 'accepted' && (
          <div className={styles.form} role="status" ref={resultHeadingRef} tabIndex={-1}>
            <Typography
              as="h2"
              className={styles.result}
            >
              {t('auth.passwordRecovery.request.accepted')}
            </Typography>
            <Button type="button" variant="outline" onClick={startNewRequest}>
              {t('auth.passwordRecovery.request.another')}
            </Button>
          </div>
        )}

        {flow.kind === 'reset' && resetState !== 'completed' && resetState !== 'unavailable' && (
          <form className={styles.form} noValidate onSubmit={(event) => void completeReset(event)}>
            <PasswordField
              id="password-recovery-new-password"
              label={t('auth.passwordRecovery.reset.newPassword')}
              value={newPassword}
              describedBy={validationError ? 'password-reset-error' : undefined}
              invalid={Boolean(validationError)}
              onChange={(value) => {
                setNewPassword(value)
                setValidationError(null)
                setResetState('ready')
              }}
            />
            <PasswordField
              id="password-recovery-confirm-password"
              label={t('auth.passwordRecovery.reset.confirmPassword')}
              value={confirmPassword}
              describedBy={validationError ? 'password-reset-error' : undefined}
              invalid={Boolean(validationError)}
              onChange={(value) => {
                setConfirmPassword(value)
                setValidationError(null)
                setResetState('ready')
              }}
            />
            {validationError && (
              <Typography id="password-reset-error" role="alert" className={styles.error}>
                {validationError}
              </Typography>
            )}
            {resetState === 'error' && (
              <Typography role="alert" className={styles.error}>
                {t('auth.passwordRecovery.networkError')}
              </Typography>
            )}
            <Button type="submit" size="lg" disabled={resetState === 'submitting'}>
              {t(resetState === 'submitting'
                ? 'auth.passwordRecovery.reset.submitting'
                : 'auth.passwordRecovery.reset.submit')}
            </Button>
          </form>
        )}

        {(showsInvalid || resetState === 'unavailable') && (
          <div className={styles.form} role="status" ref={resultHeadingRef} tabIndex={-1}>
            <Typography
              as="h2"
              className={styles.error}
            >
              {t('auth.passwordRecovery.reset.unavailable')}
            </Typography>
            <Button type="button" onClick={startNewRequest}>
              {t('auth.passwordRecovery.reset.requestNew')}
            </Button>
          </div>
        )}

        {resetState === 'completed' && (
          <div className={styles.form} role="status" ref={resultHeadingRef} tabIndex={-1}>
            <Typography
              as="h2"
              className={styles.result}
              data-outcome="completed"
            >
              {t('auth.passwordRecovery.reset.completed')}
            </Typography>
            <Button asChild size="lg">
              <Link to="/">{t('auth.passwordRecovery.reset.signIn')}</Link>
            </Button>
          </div>
        )}

        <footer className={styles.footer}>
          {showsRequest && requestState !== 'accepted' && (
            <Link to="/recover/code">{t('auth.passwordRecovery.useRecoveryCode')}</Link>
          )}
          <br />
          <Link to="/">{t('auth.recoveryCode.back')}</Link>
        </footer>
      </section>
    </div>
  )
}

function PasswordField(input: {
  describedBy?: string
  id: string
  invalid: boolean
  label: string
  onChange(value: string): void
  value: string
}) {
  return (
    <label className={styles.field} htmlFor={input.id}>
      <Typography as="span">{input.label}</Typography>
      <Input
        id={input.id}
        type="password"
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
        required
        value={input.value}
        aria-invalid={input.invalid || undefined}
        aria-describedby={input.describedBy}
        onChange={(event) => input.onChange(event.target.value)}
      />
    </label>
  )
}

function readInitialFlow(): InitialFlow {
  if (typeof window === 'undefined' || !window.location.hash) return { kind: 'request' }
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  const parsed = completePasswordResetRequestSchema.shape.token.safeParse(token)
  return parsed.success ? { kind: 'reset', token: parsed.data } : { kind: 'invalid' }
}
