import { useRef, useState, type FormEvent } from 'react'

import type { AccountProtection } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/platform/api/http-client'
import { useI18n } from '@/platform/i18n'

import type { ProfileApi } from '../api'
import {
  useConfirmRecoveryCodeReissueMutation,
  useIssueRecoveryCodesMutation,
  useStartRecoveryCodeReissueMutation,
} from '../queries'
import styles from './ProfilePage.module.css'

type ActiveProtection = Extract<AccountProtection, { state: 'password_active' }>

export function RecoveryCodeControl({
  api,
  state,
}: {
  api: ProfileApi
  state: ActiveProtection
}) {
  const { t } = useI18n()
  const issueCodes = useIssueRecoveryCodesMutation(api)
  const startReissue = useStartRecoveryCodeReissueMutation(api)
  const confirmReissue = useConfirmRecoveryCodeReissueMutation(api)
  const [isIssueOpen, setIsIssueOpen] = useState(false)
  const [isReissueOpen, setIsReissueOpen] = useState(false)
  const [reissueStep, setReissueStep] = useState<'code' | 'password'>('password')
  const [password, setPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [challenge, setChallenge] = useState<{
    codeExpiresAt: string
    maskedAccountEmail: string
  } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [skipWarning, setSkipWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const isPending = issueCodes.isPending || startReissue.isPending || confirmReissue.isPending

  const issueInitialSet = async () => {
    setError(null)
    try {
      const result = await issueCodes.mutateAsync()
      setIsIssueOpen(false)
      setRecoveryCodes(result.recoveryCodes)
    } catch (issueError) {
      setError(recoveryCodeErrorMessage(issueError, 'issue', t))
    }
  }

  const submitReissuePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    try {
      const result = await startReissue.mutateAsync({ password })
      setPassword('')
      setChallenge(result.challenge)
      setReissueStep('code')
    } catch (reissueError) {
      setError(recoveryCodeErrorMessage(reissueError, 'start', t))
    }
  }

  const submitReissueCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    try {
      const result = await confirmReissue.mutateAsync({ code: emailCode })
      setEmailCode('')
      setChallenge(null)
      setReissueStep('password')
      setIsReissueOpen(false)
      setRecoveryCodes(result.recoveryCodes)
    } catch (reissueError) {
      setError(recoveryCodeErrorMessage(reissueError, 'confirm', t))
    }
  }

  const closeCodeSheet = () => {
    setRecoveryCodes(null)
    setSaved(false)
    setSkipWarning(false)
    setFeedback(null)
    issueCodes.reset()
    confirmReissue.reset()
    triggerRef.current?.focus()
  }

  const copyCodes = async () => {
    if (!recoveryCodes) return
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'))
      setFeedback(t('profile.protection.recoveryCodes.copySuccess'))
    } catch {
      setFeedback(t('profile.protection.recoveryCodes.copyFailed'))
    }
  }

  const downloadCodes = () => {
    if (!recoveryCodes) return
    const blob = new Blob(
      [`${t('profile.protection.recoveryCodes.fileTitle')}\n\n${recoveryCodes.join('\n')}\n`],
      { type: 'text/plain;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'anomaly-detector-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
    setFeedback(t('profile.protection.recoveryCodes.downloadSuccess'))
  }

  const resetReissueDialog = () => {
    setPassword('')
    setEmailCode('')
    setChallenge(null)
    setError(null)
    setReissueStep('password')
  }

  const isInitial = state.recoveryCodes === 'not_issued'

  return (
    <>
      <div className={styles.recoveryCodeControl}>
        <Typography className={styles.recoveryCodeStatus}>
          {recoveryCodeStatusMessage(state.recoveryCodes, t)}
        </Typography>
        <Button
          ref={triggerRef}
          type="button"
          size="sm"
          variant={isInitial ? 'default' : 'outline'}
          onClick={() => {
            setError(null)
            if (isInitial) setIsIssueOpen(true)
            else setIsReissueOpen(true)
          }}
        >
          {t(isInitial
            ? 'profile.protection.recoveryCodes.issueAction'
            : 'profile.protection.recoveryCodes.reissueAction')}
        </Button>
      </div>

      <Dialog
        open={isIssueOpen}
        onOpenChange={(open) => {
          if (issueCodes.isPending) return
          setIsIssueOpen(open)
          if (!open) setError(null)
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!issueCodes.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.recoveryCodes.issueTitle')}</DialogTitle>
            <DialogDescription>
              {t('profile.protection.recoveryCodes.issueDescription')}
            </DialogDescription>
          </DialogHeader>
          {error && <Typography role="alert" className={styles.formError}>{error}</Typography>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={issueCodes.isPending}
              onClick={() => setIsIssueOpen(false)}
            >
              {t('profile.name.cancel')}
            </Button>
            <Button type="button" disabled={issueCodes.isPending} onClick={() => void issueInitialSet()}>
              {issueCodes.isPending
                ? t('profile.protection.recoveryCodes.issuing')
                : t('profile.protection.recoveryCodes.showAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isReissueOpen}
        onOpenChange={(open) => {
          if (isPending) return
          setIsReissueOpen(open)
          if (!open) resetReissueDialog()
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.recoveryCodes.reissueTitle')}</DialogTitle>
            <DialogDescription>
              {reissueStep === 'password'
                ? t('profile.protection.recoveryCodes.reissuePasswordDescription')
                : t('profile.protection.recoveryCodes.reissueCodeDescription', {
                    email: challenge?.maskedAccountEmail ?? '',
                  })}
            </DialogDescription>
          </DialogHeader>
          {reissueStep === 'password' ? (
            <form className={styles.protectionForm} onSubmit={(event) => void submitReissuePassword(event)}>
              <label className={styles.protectionField} htmlFor="recovery-code-reissue-password">
                <Typography as="span">{t('profile.protection.passwordLabel')}</Typography>
                <Input
                  autoFocus
                  autoComplete="current-password"
                  id="recovery-code-reissue-password"
                  minLength={8}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                  }}
                />
              </label>
              {error && <Typography role="alert" className={styles.formError}>{error}</Typography>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsReissueOpen(false)}>
                  {t('profile.name.cancel')}
                </Button>
                <Button type="submit" disabled={startReissue.isPending || password.length < 8}>
                  {startReissue.isPending
                    ? t('profile.protection.startPending')
                    : t('profile.protection.recoveryCodes.sendCodeAction')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form className={styles.protectionForm} onSubmit={(event) => void submitReissueCode(event)}>
              <label className={styles.protectionField} htmlFor="recovery-code-reissue-email-code">
                <Typography as="span">{t('profile.protection.codeLabel')}</Typography>
                <Input
                  autoFocus
                  autoComplete="one-time-code"
                  id="recovery-code-reissue-email-code"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  value={emailCode}
                  onChange={(event) => {
                    setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    setError(null)
                  }}
                />
              </label>
              <Typography className={styles.protectionNote}>
                {t('profile.protection.codeExpires', {
                  date: challenge ? formatRecoveryCodeTime(challenge.codeExpiresAt) : '',
                })}
              </Typography>
              {error && <Typography role="alert" className={styles.formError}>{error}</Typography>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsReissueOpen(false)}>
                  {t('profile.name.cancel')}
                </Button>
                <Button type="submit" disabled={confirmReissue.isPending || emailCode.length !== 6}>
                  {confirmReissue.isPending
                    ? t('profile.protection.codePending')
                    : t('profile.protection.recoveryCodes.reissueConfirmAction')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={recoveryCodes !== null} onOpenChange={() => undefined}>
        <DialogContent
          className={`${styles.protectionDialog} ${styles.recoveryCodeSheet}`}
          showCloseButton={false}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.recoveryCodes.sheetTitle')}</DialogTitle>
            <DialogDescription>
              {skipWarning
                ? t('profile.protection.recoveryCodes.skipWarning')
                : t('profile.protection.recoveryCodes.sheetDescription')}
            </DialogDescription>
          </DialogHeader>
          {!skipWarning && recoveryCodes && (
            <>
              <ol className={styles.recoveryCodeList} aria-label={t('profile.protection.recoveryCodes.listLabel')}>
                {recoveryCodes.map((code, index) => (
                  <li key={index}><Typography as="code" variant="code">{code}</Typography></li>
                ))}
              </ol>
              <div className={styles.recoveryCodeExportActions}>
                <Button type="button" size="sm" variant="outline" onClick={() => void copyCodes()}>
                  {t('profile.protection.recoveryCodes.copyAction')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={downloadCodes}>
                  {t('profile.protection.recoveryCodes.downloadAction')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
                  {t('profile.protection.recoveryCodes.printAction')}
                </Button>
              </div>
              {feedback && (
                <Typography role="status" className={styles.protectionFeedback}>{feedback}</Typography>
              )}
              <div className={styles.recoveryCodeSavedConfirmation}>
                <Checkbox
                  id="recovery-codes-saved"
                  checked={saved}
                  onCheckedChange={(checked) => setSaved(checked === true)}
                />
                <Label htmlFor="recovery-codes-saved">
                  {t('profile.protection.recoveryCodes.savedConfirmation')}
                </Label>
              </div>
            </>
          )}
          <DialogFooter>
            {skipWarning ? (
              <>
                <Button type="button" variant="outline" onClick={() => setSkipWarning(false)}>
                  {t('profile.protection.recoveryCodes.returnAction')}
                </Button>
                <Button type="button" variant="destructive" onClick={closeCodeSheet}>
                  {t('profile.protection.recoveryCodes.skipConfirmAction')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => setSkipWarning(true)}>
                  {t('profile.protection.recoveryCodes.skipAction')}
                </Button>
                <Button type="button" disabled={!saved} onClick={closeCodeSheet}>
                  {t('profile.protection.recoveryCodes.savedCloseAction')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function recoveryCodeErrorMessage(
  error: unknown,
  operation: 'confirm' | 'issue' | 'start',
  t: ReturnType<typeof useI18n>['t'],
) {
  if (error instanceof ApiRequestError) {
    if (operation === 'start' && error.status === 401) {
      return t('profile.protection.errorPassword')
    }
    if (operation === 'confirm' && error.status === 400) {
      return t('profile.protection.errorCode')
    }
    if (error.status === 429) return t('profile.protection.errorLimited')
    if (error.status === 409) return t('profile.protection.recoveryCodes.errorUnavailable')
  }
  return t('profile.protection.errorGeneric')
}

function formatRecoveryCodeTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function recoveryCodeStatusMessage(
  state: ActiveProtection['recoveryCodes'],
  t: ReturnType<typeof useI18n>['t'],
) {
  switch (state) {
    case 'available':
      return t('profile.protection.recoveryCodes.status.available')
    case 'consumed':
      return t('profile.protection.recoveryCodes.status.consumed')
    case 'not_issued':
      return t('profile.protection.recoveryCodes.status.not_issued')
  }
}
