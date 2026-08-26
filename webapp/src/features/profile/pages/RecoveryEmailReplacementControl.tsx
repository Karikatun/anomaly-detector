import { useRef, useState, type FormEvent, type RefObject } from 'react'

import type { AccountProtection } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/platform/api/http-client'
import { useI18n } from '@/platform/i18n'

import type { ProfileApi } from '../api'
import {
  useCancelRecoveryEmailReplacementMutation,
  useConfirmRecoveryEmailReplacementMutation,
  useResendRecoveryEmailReplacementMutation,
  useStartRecoveryEmailReplacementMutation,
} from '../queries'
import styles from './ProfilePage.module.css'
import { RecoveryCodeControl } from './RecoveryCodeControl'

type ActiveProtection = Extract<AccountProtection, { state: 'password_active' }>
type ReplacingProtection = Extract<AccountProtection, { state: 'password_replacing' }>
type ReplacementFactor = 'new' | 'old'

export function RecoveryEmailReplacementControl({
  api,
  state,
}: {
  api: ProfileApi
  state: ActiveProtection | ReplacingProtection
}) {
  const { t } = useI18n()
  const startReplacement = useStartRecoveryEmailReplacementMutation(api)
  const resendReplacement = useResendRecoveryEmailReplacementMutation(api)
  const confirmReplacement = useConfirmRecoveryEmailReplacementMutation(api)
  const cancelReplacement = useCancelRecoveryEmailReplacementMutation(api)
  const [isStartOpen, setIsStartOpen] = useState(false)
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  const [isCancelOpen, setIsCancelOpen] = useState(false)
  const [factor, setFactor] = useState<ReplacementFactor | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const startButtonRef = useRef<HTMLButtonElement>(null)
  const oldCodeButtonRef = useRef<HTMLButtonElement>(null)
  const newCodeButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const lastFactorRef = useRef<ReplacementFactor>('old')
  const isMutating = startReplacement.isPending
    || resendReplacement.isPending
    || confirmReplacement.isPending
    || cancelReplacement.isPending

  const submitStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStartError(null)
    setActionFeedback(null)
    try {
      await startReplacement.mutateAsync({ email, password })
      clearStartSecrets()
      setIsStartOpen(false)
    } catch (error) {
      setStartError(replacementErrorMessage(error, 'start', t))
    }
  }

  const openCode = (nextFactor: ReplacementFactor) => {
    lastFactorRef.current = nextFactor
    setFactor(nextFactor)
    setCode('')
    setCodeError(null)
    setActionFeedback(null)
    setIsCodeOpen(true)
  }

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!factor) return
    setCodeError(null)
    setActionFeedback(null)
    try {
      const result = await confirmReplacement.mutateAsync({ code, factor })
      const confirmedFactor = factor === 'old'
        ? t('profile.protection.replacement.oldAddress')
        : t('profile.protection.replacement.newAddress')
      clearCodeSecret()
      setIsCodeOpen(false)
      setFactor(null)
      setActionFeedback(
        result.replacement.status === 'completed'
          ? t('profile.protection.replacement.completed')
          : t('profile.protection.replacement.factorConfirmedFeedback', {
              factor: confirmedFactor,
            }),
      )
    } catch (error) {
      setCodeError(replacementErrorMessage(error, 'confirm', t))
    }
  }

  const resendCode = async (targetFactor: ReplacementFactor) => {
    setActionFeedback(null)
    try {
      await resendReplacement.mutateAsync({ factor: targetFactor })
      setActionFeedback(t('profile.protection.replacement.resendSuccess'))
    } catch (error) {
      setActionFeedback(replacementErrorMessage(error, 'resend', t))
    }
  }

  const cancel = async () => {
    setCancelError(null)
    setActionFeedback(null)
    try {
      await cancelReplacement.mutateAsync()
      clearCodeSecret()
      setIsCancelOpen(false)
      setActionFeedback(t('profile.protection.replacement.cancelled'))
    } catch (error) {
      setCancelError(replacementErrorMessage(error, 'cancel', t))
    }
  }

  const clearStartSecrets = () => {
    setEmail('')
    setPassword('')
    setStartError(null)
  }
  const clearCodeSecret = () => {
    setCode('')
    setCodeError(null)
  }

  const selectedAddress = state.state === 'password_replacing' && factor
    ? state[factor === 'old' ? 'oldAddress' : 'newAddress']
    : null

  return (
    <section
      id="account-protection"
      ref={sectionRef}
      className={`${styles.protectionSection} ${state.state === 'password_replacing' ? styles.replacementSection : ''}`}
      aria-labelledby="profile-protection-title"
      tabIndex={-1}
    >
      <div className={styles.protectionCopy}>
        <Typography as="h2" id="profile-protection-title" className={styles.protectionTitle}>
          {state.state === 'password_active'
            ? t('profile.protection.title')
            : t('profile.protection.replacement.pendingTitle')}
        </Typography>
        <Typography className={styles.protectionDescription}>
          {state.state === 'password_active'
            ? t('profile.protection.activeDescription')
            : t('profile.protection.replacement.pendingDescription')}
        </Typography>
        {state.state === 'password_replacing' && !state.canManage && (
          <Typography className={styles.protectionNote}>
            {t('profile.protection.replacement.otherSession')}
          </Typography>
        )}
        {actionFeedback && (
          <Typography role="status" className={styles.protectionFeedback}>
            {actionFeedback}
          </Typography>
        )}
      </div>

      {state.state === 'password_active' ? (
        <div className={styles.protectionControlColumn}>
          <div className={styles.protectionState} data-tone="managed">
            <Typography className={styles.protectionLabel}>
              {t('profile.protection.active')}
            </Typography>
            <Typography className={styles.protectionValue}>
              {state.maskedAccountEmail}
            </Typography>
          </div>
          <div className={styles.protectionActions}>
            <RecoveryCodeControl api={api} state={state} />
            <Button
              ref={startButtonRef}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsStartOpen(true)}
            >
              {t('profile.protection.replacement.action')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.replacementControl}>
          <div className={styles.replacementFactors}>
            <ReplacementFactorCard
              address={state.oldAddress}
              canManage={state.canManage}
              factor="old"
              isMutating={isMutating}
              buttonRef={oldCodeButtonRef}
              onEnterCode={openCode}
              onResend={resendCode}
            />
            <ReplacementFactorCard
              address={state.newAddress}
              canManage={state.canManage}
              factor="new"
              isMutating={isMutating}
              buttonRef={newCodeButtonRef}
              onEnterCode={openCode}
              onResend={resendCode}
            />
          </div>
          {state.canManage && (
            <Button
              ref={cancelButtonRef}
              type="button"
              size="sm"
              variant="ghost"
              disabled={isMutating}
              onClick={() => setIsCancelOpen(true)}
            >
              {t('profile.protection.replacement.cancelAction')}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={isStartOpen && state.state === 'password_active'}
        onOpenChange={(open) => {
          if (startReplacement.isPending) return
          setIsStartOpen(open)
          if (!open) clearStartSecrets()
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!startReplacement.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            ;(startButtonRef.current ?? sectionRef.current)?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.replacement.startTitle')}</DialogTitle>
            <DialogDescription>
              {t('profile.protection.replacement.startDescription')}
            </DialogDescription>
          </DialogHeader>
          <form className={styles.protectionForm} onSubmit={(event) => void submitStart(event)}>
            <label className={styles.protectionField} htmlFor="replacement-email">
              <Typography as="span">
                {t('profile.protection.replacement.emailLabel')}
              </Typography>
              <Input
                autoFocus
                autoComplete="email"
                id="replacement-email"
                maxLength={254}
                required
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setStartError(null)
                }}
              />
            </label>
            <label className={styles.protectionField} htmlFor="replacement-password">
              <Typography as="span">{t('profile.protection.passwordLabel')}</Typography>
              <Input
                autoComplete="current-password"
                id="replacement-password"
                minLength={8}
                required
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setStartError(null)
                }}
              />
            </label>
            {startError && (
              <Typography role="alert" className={styles.formError}>{startError}</Typography>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={startReplacement.isPending}
                onClick={() => {
                  clearStartSecrets()
                  setIsStartOpen(false)
                }}
              >
                {t('profile.name.cancel')}
              </Button>
              <Button type="submit" disabled={startReplacement.isPending}>
                {startReplacement.isPending
                  ? t('profile.protection.replacement.startPending')
                  : t('profile.protection.replacement.startSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCodeOpen && state.state === 'password_replacing' && selectedAddress !== null}
        onOpenChange={(open) => {
          if (confirmReplacement.isPending) return
          setIsCodeOpen(open)
          if (!open) {
            clearCodeSecret()
            setFactor(null)
          }
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!confirmReplacement.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const button = lastFactorRef.current === 'old'
              ? oldCodeButtonRef.current
              : newCodeButtonRef.current
            ;(button ?? cancelButtonRef.current ?? sectionRef.current)?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {factor === 'old'
                ? t('profile.protection.replacement.codeTitleOld')
                : t('profile.protection.replacement.codeTitleNew')}
            </DialogTitle>
            <DialogDescription>
              {t('profile.protection.replacement.codeDescription', {
                email: selectedAddress?.maskedAccountEmail ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <form className={styles.protectionForm} onSubmit={(event) => void submitCode(event)}>
            <label className={styles.protectionField} htmlFor="replacement-code">
              <Typography as="span">{t('profile.protection.codeLabel')}</Typography>
              <Input
                autoFocus
                autoComplete="one-time-code"
                id="replacement-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  setCodeError(null)
                }}
              />
            </label>
            {codeError && (
              <Typography role="alert" className={styles.formError}>{codeError}</Typography>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={confirmReplacement.isPending}
                onClick={() => {
                  clearCodeSecret()
                  setIsCodeOpen(false)
                  setFactor(null)
                }}
              >
                {t('profile.name.cancel')}
              </Button>
              <Button type="submit" disabled={confirmReplacement.isPending || code.length !== 6}>
                {confirmReplacement.isPending
                  ? t('profile.protection.codePending')
                  : t('profile.protection.codeSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCancelOpen && state.state === 'password_replacing' && state.canManage}
        onOpenChange={(open) => {
          if (cancelReplacement.isPending) return
          setIsCancelOpen(open)
          if (!open) setCancelError(null)
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!cancelReplacement.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            ;(cancelButtonRef.current ?? sectionRef.current)?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.replacement.cancelTitle')}</DialogTitle>
            <DialogDescription>
              {t('profile.protection.replacement.cancelDescription')}
            </DialogDescription>
          </DialogHeader>
          {cancelError && (
            <Typography role="alert" className={styles.formError}>{cancelError}</Typography>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={cancelReplacement.isPending}
              onClick={() => setIsCancelOpen(false)}
            >
              {t('profile.name.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelReplacement.isPending}
              onClick={() => void cancel()}
            >
              {cancelReplacement.isPending
                ? t('profile.protection.replacement.cancelling')
                : t('profile.protection.replacement.cancelSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ReplacementFactorCard({
  address,
  buttonRef,
  canManage,
  factor,
  isMutating,
  onEnterCode,
  onResend,
}: {
  address: ReplacingProtection['oldAddress']
  buttonRef: RefObject<HTMLButtonElement | null>
  canManage: boolean
  factor: ReplacementFactor
  isMutating: boolean
  onEnterCode: (factor: ReplacementFactor) => void
  onResend: (factor: ReplacementFactor) => Promise<void>
}) {
  const { t } = useI18n()
  const status = replacementFactorContent(address, t)
  const factorLabel = factor === 'old'
    ? t('profile.protection.replacement.oldAddress')
    : t('profile.protection.replacement.newAddress')
  const canEnterCode = canManage && address.status === 'pending'
  const canResend = canManage && (address.status === 'pending' || address.status === 'expired')

  return (
    <section
      className={styles.replacementFactor}
      data-status={address.status}
      aria-labelledby={`replacement-${factor}-address-title`}
    >
      <div className={styles.replacementFactorHeader}>
        <Typography
          as="h3"
          id={`replacement-${factor}-address-title`}
          className={styles.replacementFactorName}
        >
          {factorLabel}
        </Typography>
        <Typography className={styles.replacementFactorStatus}>{status.label}</Typography>
      </div>
      <Typography className={styles.replacementFactorValue}>
        {address.maskedAccountEmail}
      </Typography>
      <Typography className={styles.replacementFactorNote}>{status.note}</Typography>
      {(canEnterCode || canResend) && (
        <div className={styles.replacementFactorActions}>
          {canEnterCode && (
            <Button
              ref={buttonRef}
              type="button"
              size="sm"
              aria-label={`${t('profile.protection.replacement.enterCode')}: ${factorLabel}`}
              disabled={isMutating}
              onClick={() => onEnterCode(factor)}
            >
              {t('profile.protection.replacement.enterCode')}
            </Button>
          )}
          {canResend && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`${t('profile.protection.replacement.resend')}: ${factorLabel}`}
              disabled={isMutating}
              onClick={() => void onResend(factor)}
            >
              {t('profile.protection.replacement.resend')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function replacementFactorContent(
  address: ReplacingProtection['oldAddress'],
  t: ReturnType<typeof useI18n>['t'],
) {
  switch (address.status) {
    case 'pending':
      return {
        label: t('profile.protection.replacement.statusPending'),
        note: t('profile.protection.replacement.factorExpires', {
          date: formatProtectionTime(address.codeExpiresAt),
        }),
      }
    case 'confirmed':
      return {
        label: t('profile.protection.replacement.statusConfirmed'),
        note: t('profile.protection.replacement.factorConfirmed'),
      }
    case 'expired':
      return {
        label: t('profile.protection.replacement.statusExpired'),
        note: t('profile.protection.replacement.factorExpired'),
      }
    case 'service_blocked':
      return {
        label: t('profile.protection.replacement.statusBlocked'),
        note: t('profile.protection.replacement.factorBlocked'),
      }
  }
}

function replacementErrorMessage(
  error: unknown,
  operation: 'cancel' | 'confirm' | 'resend' | 'start',
  t: ReturnType<typeof useI18n>['t'],
) {
  if (error instanceof ApiRequestError) {
    if (operation === 'start' && error.status === 401) {
      return t('profile.protection.errorPassword')
    }
    if (operation === 'confirm' && error.status === 400) {
      return t('profile.protection.errorCode')
    }
    if (error.status === 403) return t('profile.protection.replacement.errorSession')
    if (error.status === 429) return t('profile.protection.errorLimited')
    if (error.status === 400 || error.status === 409) {
      return t('profile.protection.errorUnavailable')
    }
  }
  return t('profile.protection.errorGeneric')
}

function formatProtectionTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}
