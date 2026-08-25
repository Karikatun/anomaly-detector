import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  PencilEdit01Icon,
  Refresh01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useRef, useState, type FormEvent } from 'react'

import {
  displayNameMaxLength,
  displayNameMinLength,
  type AccountProtection,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { ApiRequestError } from '@/platform/api/http-client'
import { productAnalytics } from '@/platform/analytics/product-analytics'
import { useI18n } from '@/platform/i18n'

import { ProfileApi } from '../api'
import {
  useAccountProtectionQuery,
  useCancelRecoveryEmailMutation,
  useConfirmRecoveryEmailMutation,
  useProfileStatisticsQuery,
  useResendRecoveryEmailMutation,
  useStartRecoveryEmailMutation,
} from '../queries'
import { RecoveryEmailReplacementControl } from './RecoveryEmailReplacementControl'
import styles from './ProfilePage.module.css'

export function ProfilePage() {
  return (
    <ProtectedPage>
      <ProfileContent />
    </ProtectedPage>
  )
}

function ProfileContent() {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const user = auth.user
  const api = useMemo(() => new ProfileApi(auth.transport), [auth.transport])
  const statistics = useProfileStatisticsQuery(api)
  const accountProtection = useAccountProtectionQuery(api)

  if (!user) return null

  return (
    <main className={styles.screen}>
      <div className={styles.background} aria-hidden="true" />
      <section className={styles.panel} aria-labelledby="profile-page-title">
        <header className={styles.pageHeader}>
          <Typography variant="h1" id="profile-page-title" className={styles.pageTitle}>
            {t('profile.title')}
          </Typography>
          <Button
            type="button"
            variant="ghost"
            className={styles.backButton}
            onClick={() => void navigate({ to: '/' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.7} aria-hidden="true" />
            {t('profile.back')}
          </Button>
        </header>

        <div className={styles.profileCard}>
          <div className={styles.identitySection}>
            <DisplayNameEditor
              currentName={user.displayName ?? ''}
              displayName={user.displayName ?? user.login}
              onSave={(input) => auth.updateProfile(input)}
            />
            <img
              className={styles.emblem}
              src="/assets/profile-emblem.svg"
              alt=""
              aria-hidden="true"
            />
          </div>

          <AccountProtectionContent api={api} protection={accountProtection} />

          <StatisticsContent statistics={statistics} />

          <Typography className={styles.memberSince}>
            {t('profile.memberSince', { date: formatRegistrationDate(user.createdAt) })}
          </Typography>
        </div>

        <DeleteAccountControl
          onDelete={async () => {
            await auth.deleteAccount()
            await navigate({ to: '/', replace: true })
          }}
        />
      </section>
    </main>
  )
}

function AccountProtectionContent({
  api,
  protection,
}: {
  api: ProfileApi
  protection: ReturnType<typeof useAccountProtectionQuery>
}) {
  const { t } = useI18n()
  const startRecoveryEmail = useStartRecoveryEmailMutation(api)
  const resendRecoveryEmail = useResendRecoveryEmailMutation(api)
  const confirmRecoveryEmail = useConfirmRecoveryEmailMutation(api)
  const cancelRecoveryEmail = useCancelRecoveryEmailMutation(api)
  const [isStartOpen, setIsStartOpen] = useState(false)
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  const [isCancelOpen, setIsCancelOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const startButtonRef = useRef<HTMLButtonElement>(null)
  const codeButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  if (protection.isPending) {
    return (
      <section
        id="account-protection"
        className={styles.protectionSection}
        aria-labelledby="profile-protection-title"
      >
        <Typography as="h2" id="profile-protection-title" className={styles.protectionTitle}>
          {t('profile.protection.title')}
        </Typography>
        <Typography role="status" className={styles.protectionDescription}>
          {t('profile.protection.loading')}
        </Typography>
      </section>
    )
  }

  if (protection.isError) {
    return (
      <section
        id="account-protection"
        className={styles.protectionSection}
        aria-labelledby="profile-protection-title"
      >
        <div className={styles.protectionCopy}>
          <Typography as="h2" id="profile-protection-title" className={styles.protectionTitle}>
            {t('profile.protection.title')}
          </Typography>
          <Typography role="alert" className={styles.protectionDescription}>
            {t('profile.protection.failed')}
          </Typography>
        </div>
        <Button type="button" variant="outline" onClick={() => void protection.refetch()}>
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.7} aria-hidden="true" />
          {t('profile.protection.retry')}
        </Button>
      </section>
    )
  }

  const state = protection.data.accountProtection
  if (state.state === 'password_active' || state.state === 'password_replacing') {
    return <RecoveryEmailReplacementControl api={api} state={state} />
  }
  const content = protectionContent(state, t)
  const canCancel = 'canCancel' in state && state.canCancel
  const isMutating = startRecoveryEmail.isPending
    || resendRecoveryEmail.isPending
    || confirmRecoveryEmail.isPending
    || cancelRecoveryEmail.isPending

  const submitStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStartError(null)
    setActionFeedback(null)
    try {
      await startRecoveryEmail.mutateAsync({ email, password })
      setEmail('')
      setPassword('')
      setIsStartOpen(false)
      setCode('')
      setIsCodeOpen(true)
    } catch (error) {
      setStartError(recoveryEmailErrorMessage(error, 'start', t))
    }
  }

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCodeError(null)
    setActionFeedback(null)
    try {
      await confirmRecoveryEmail.mutateAsync({ code })
      void productAnalytics.record('recovery_email_confirmed')
      setCode('')
      setIsCodeOpen(false)
    } catch (error) {
      setCodeError(recoveryEmailErrorMessage(error, 'confirm', t))
    }
  }

  const resendCode = async () => {
    setActionFeedback(null)
    try {
      await resendRecoveryEmail.mutateAsync()
      setActionFeedback(t('profile.protection.resendSuccess'))
    } catch (error) {
      setActionFeedback(recoveryEmailErrorMessage(error, 'resend', t))
    }
  }

  const cancelProtection = async () => {
    setCancelError(null)
    setActionFeedback(null)
    try {
      await cancelRecoveryEmail.mutateAsync()
      setIsCancelOpen(false)
    } catch (error) {
      setCancelError(recoveryEmailErrorMessage(error, 'cancel', t))
    }
  }

  return (
    <section
      id="account-protection"
      ref={sectionRef}
      className={styles.protectionSection}
      aria-labelledby="profile-protection-title"
      tabIndex={-1}
    >
      <div className={styles.protectionCopy}>
        <Typography as="h2" id="profile-protection-title" className={styles.protectionTitle}>
          {t('profile.protection.title')}
        </Typography>
        <Typography className={styles.protectionDescription}>{content.description}</Typography>
        {content.note && (
          <Typography className={styles.protectionNote}>{content.note}</Typography>
        )}
        {actionFeedback && (
          <Typography role="status" className={styles.protectionFeedback}>
            {actionFeedback}
          </Typography>
        )}
      </div>
      <div className={styles.protectionControlColumn}>
        <div className={styles.protectionState} data-tone={content.tone}>
          <Typography className={styles.protectionLabel}>{content.label}</Typography>
          {content.value && (
            <Typography className={styles.protectionValue}>{content.value}</Typography>
          )}
        </div>
        <div className={styles.protectionActions}>
          {state.state === 'password_unprotected' && (
            <Button ref={startButtonRef} type="button" size="sm" onClick={() => setIsStartOpen(true)}>
              {t('profile.protection.startAction')}
            </Button>
          )}
          {state.state === 'password_pending_code' && (
            <>
              <Button ref={codeButtonRef} type="button" size="sm" onClick={() => setIsCodeOpen(true)}>
                {t('profile.protection.enterCode')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isMutating}
                onClick={() => void resendCode()}
              >
                {resendRecoveryEmail.isPending
                  ? t('profile.protection.resending')
                  : t('profile.protection.resend')}
              </Button>
            </>
          )}
          {canCancel && (
            <Button
              type="button"
              ref={cancelButtonRef}
              size="sm"
              variant="ghost"
              disabled={isMutating}
              onClick={() => setIsCancelOpen(true)}
            >
              {t('profile.protection.cancelAction')}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={isStartOpen}
        onOpenChange={(open) => {
          if (startRecoveryEmail.isPending) return
          setIsStartOpen(open)
          if (!open) {
            setEmail('')
            setPassword('')
            setStartError(null)
          }
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!startRecoveryEmail.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = startButtonRef.current ?? codeButtonRef.current ?? sectionRef.current
            target?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.startTitle')}</DialogTitle>
            <DialogDescription>{t('profile.protection.startDescription')}</DialogDescription>
          </DialogHeader>
          <form className={styles.protectionForm} onSubmit={(event) => void submitStart(event)}>
            <label className={styles.protectionField} htmlFor="recovery-email">
              <Typography as="span">{t('profile.protection.emailLabel')}</Typography>
              <Input
                autoFocus
                autoComplete="email"
                id="recovery-email"
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
            <label className={styles.protectionField} htmlFor="recovery-password">
              <Typography as="span">{t('profile.protection.passwordLabel')}</Typography>
              <Input
                autoComplete="current-password"
                id="recovery-password"
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
            {startError && <Typography role="alert" className={styles.formError}>{startError}</Typography>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={startRecoveryEmail.isPending}
                onClick={() => {
                  setEmail('')
                  setPassword('')
                  setIsStartOpen(false)
                }}
              >
                {t('profile.protection.later')}
              </Button>
              <Button type="submit" disabled={startRecoveryEmail.isPending}>
                {startRecoveryEmail.isPending
                  ? t('profile.protection.startPending')
                  : t('profile.protection.startSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCodeOpen && state.state === 'password_pending_code'}
        onOpenChange={(open) => {
          if (confirmRecoveryEmail.isPending) return
          setIsCodeOpen(open)
          if (!open) {
            setCode('')
            setCodeError(null)
          }
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!confirmRecoveryEmail.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = codeButtonRef.current ?? cancelButtonRef.current ?? sectionRef.current
            target?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.codeTitle')}</DialogTitle>
            <DialogDescription>
              {t('profile.protection.codeDescription', { email: content.value ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <form className={styles.protectionForm} onSubmit={(event) => void submitCode(event)}>
            <label className={styles.protectionField} htmlFor="recovery-code">
              <Typography as="span">{t('profile.protection.codeLabel')}</Typography>
              <Input
                autoFocus
                autoComplete="one-time-code"
                id="recovery-code"
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
            {codeError && <Typography role="alert" className={styles.formError}>{codeError}</Typography>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={confirmRecoveryEmail.isPending}
                onClick={() => {
                  setCode('')
                  setIsCodeOpen(false)
                }}
              >
                {t('profile.protection.later')}
              </Button>
              <Button type="submit" disabled={confirmRecoveryEmail.isPending || code.length !== 6}>
                {confirmRecoveryEmail.isPending
                  ? t('profile.protection.codePending')
                  : t('profile.protection.codeSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCancelOpen && canCancel}
        onOpenChange={(open) => {
          if (cancelRecoveryEmail.isPending) return
          setIsCancelOpen(open)
          if (!open) setCancelError(null)
        }}
      >
        <DialogContent
          className={styles.protectionDialog}
          showCloseButton={!cancelRecoveryEmail.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = cancelButtonRef.current ?? startButtonRef.current ?? sectionRef.current
            target?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('profile.protection.cancelTitle')}</DialogTitle>
            <DialogDescription>{t('profile.protection.cancelDescription')}</DialogDescription>
          </DialogHeader>
          {cancelError && <Typography role="alert" className={styles.formError}>{cancelError}</Typography>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={cancelRecoveryEmail.isPending}
              onClick={() => setIsCancelOpen(false)}
            >
              {t('profile.name.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelRecoveryEmail.isPending}
              onClick={() => void cancelProtection()}
            >
              {cancelRecoveryEmail.isPending
                ? t('profile.protection.cancelling')
                : t('profile.protection.cancelSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function protectionContent(
  state: AccountProtection,
  t: ReturnType<typeof useI18n>['t'],
) {
  switch (state.state) {
    case 'password_unprotected':
      return {
        description: t('profile.protection.passwordDescription'),
        label: t('profile.protection.password'),
        note: t('profile.protection.optional'),
        tone: 'neutral',
        value: null,
      }
    case 'password_pending_code':
      return {
        description: t('profile.protection.pendingDescription'),
        label: t('profile.protection.pending'),
        note: t('profile.protection.codeExpires', { date: formatProtectionTime(state.codeExpiresAt) }),
        tone: 'attention',
        value: state.maskedAccountEmail,
      }
    case 'password_cooling_off':
      return {
        description: t('profile.protection.coolingDescription'),
        label: t('profile.protection.cooling'),
        note: state.canCancel
          ? t('profile.protection.activates', { date: formatProtectionTime(state.activatesAt) })
          : t('profile.protection.cancelFromOlderSession'),
        tone: 'attention',
        value: state.maskedAccountEmail,
      }
    case 'password_active':
      return {
        description: t('profile.protection.activeDescription'),
        label: t('profile.protection.active'),
        note: null,
        tone: 'managed',
        value: state.maskedAccountEmail,
      }
    case 'password_replacing':
      return {
        description: t('profile.protection.replacement.pendingDescription'),
        label: t('profile.protection.replacement.pendingTitle'),
        note: state.canManage ? null : t('profile.protection.replacement.otherSession'),
        tone: 'attention',
        value: null,
      }
    case 'password_service_blocked':
      return {
        description: t('profile.protection.blockedDescription'),
        label: t('profile.protection.blocked'),
        note: state.canCancel ? t('profile.protection.blockedCancelable') : null,
        tone: 'attention',
        value: state.maskedAccountEmail,
      }
    case 'yandex_managed':
      return {
        description: t('profile.protection.yandexManagedDescription'),
        label: t('profile.protection.yandexManaged'),
        note: null,
        tone: 'managed',
        value: state.maskedAccountEmail,
      }
    case 'yandex_conflict':
      return {
        description: t('profile.protection.yandexConflictDescription'),
        label: t('profile.protection.yandexConflict'),
        note: t('profile.protection.yandexContinues'),
        tone: 'attention',
        value: null,
      }
    case 'yandex_unavailable':
      return {
        description: t('profile.protection.yandexUnavailableDescription'),
        label: t('profile.protection.yandexUnavailable'),
        note: t('profile.protection.yandexContinues'),
        tone: 'attention',
        value: null,
      }
  }
}

function recoveryEmailErrorMessage(
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
    if (operation === 'cancel' && error.status === 403) {
      return t('profile.protection.errorCancelSession')
    }
    if (error.status === 429) return t('profile.protection.errorLimited')
    if (error.status === 400 || error.status === 409) {
      return t('profile.protection.errorUnavailable')
    }
  }
  return t('profile.protection.errorGeneric')
}

function DeleteAccountControl({
  onDelete,
}: {
  onDelete: () => Promise<void>
}) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deletionError, setDeletionError] = useState<string | null>(null)

  const handleOpenChange = (open: boolean) => {
    if (isDeleting) return
    setIsOpen(open)
    if (!open) setDeletionError(null)
  }

  const deleteAccount = async () => {
    setDeletionError(null)
    setIsDeleting(true)
    try {
      await onDelete()
    } catch (error) {
      setDeletionError(
        error instanceof ApiRequestError && error.status === 403
          ? t('profile.delete.reauthenticate')
          : t('profile.delete.failed'),
      )
      setIsDeleting(false)
    }
  }

  return (
    <section className={styles.dangerZone} aria-labelledby="delete-account-title">
      <span className={styles.dangerCopy}>
        <Typography as="h2" id="delete-account-title" className={styles.dangerTitle}>
          {t('profile.delete.sectionTitle')}
        </Typography>
        <Typography className={styles.dangerDescription}>
          {t('profile.delete.sectionDescription')}
        </Typography>
      </span>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" className={styles.deleteAccountButton}>
            {t('profile.delete.action')}
          </Button>
        </DialogTrigger>
        <DialogContent className={styles.deletionDialog} showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>{t('profile.delete.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('profile.delete.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          {deletionError && (
            <Typography role="alert" variant="bodySm" tone="destructive">
              {deletionError}
            </Typography>
          )}

          <DialogFooter className={styles.deletionActions}>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isDeleting}>
                {t('profile.name.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void deleteAccount()}
            >
              {isDeleting ? t('profile.delete.pending') : t('profile.delete.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function DisplayNameEditor({
  currentName,
  displayName,
  onSave,
}: {
  currentName: string
  displayName: string
  onSave: (input: { displayName: string }) => Promise<void>
}) {
  const { t } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { displayName: currentName },
    onSubmit: async ({ value }) => {
      const displayName = value.displayName.trim()
      if (
        displayName.length < displayNameMinLength
        || displayName.length > displayNameMaxLength
        || displayName === currentName
      ) return

      setServerError(null)
      try {
        await onSave({ displayName })
        setIsEditing(false)
      } catch (saveError) {
        setServerError(saveError instanceof Error ? saveError.message : t('profile.name.saveFailed'))
      }
    },
  })

  const cancel = () => {
    form.reset({ displayName: currentName })
    setServerError(null)
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <div className={styles.identity}>
        <Typography as="h2" className={styles.playerName}>{displayName}</Typography>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles.editButton}
          aria-label={t('profile.name.edit')}
          onClick={() => {
            form.reset({ displayName: currentName })
            setServerError(null)
            setIsEditing(true)
          }}
        >
          <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={1.7} aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <form
      className={styles.nameForm}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <Typography asChild className={styles.srOnly}>
        <label htmlFor="profile-display-name">{t('profile.name.label')}</label>
      </Typography>
      <form.Field name="displayName">
        {(field) => {
          const trimmedName = field.state.value.trim()
          const isValid = trimmedName.length >= displayNameMinLength
            && trimmedName.length <= displayNameMaxLength
          return (
            <>
              <div className={styles.nameControls}>
                <Input
                  autoFocus
                  id="profile-display-name"
                  type="text"
                  maxLength={displayNameMaxLength}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    setServerError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancel()
                    }
                  }}
                  className={styles.nameInput}
                />
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <>
                      <Button
                        type="submit"
                        size="icon"
                        className={styles.saveButton}
                        aria-label={t('profile.name.save')}
                        disabled={isSubmitting || !isValid || trimmedName === currentName}
                      >
                        <HugeiconsIcon icon={Tick02Icon} strokeWidth={1.8} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={styles.cancelButton}
                        aria-label={t('profile.name.cancel')}
                        disabled={isSubmitting}
                        onClick={cancel}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </form.Subscribe>
              </div>
              {!isValid && field.state.value.length > 0 && (
                <Typography role="alert" className={styles.formError}>
                  {t('profile.name.invalid')}
                </Typography>
              )}
              {serverError && (
                <Typography role="alert" className={styles.formError}>{serverError}</Typography>
              )}
            </>
          )
        }}
      </form.Field>
    </form>
  )
}

function StatisticsContent({
  statistics,
}: {
  statistics: ReturnType<typeof useProfileStatisticsQuery>
}) {
  const { t } = useI18n()
  if (statistics.isPending) {
    const skeletons = Array.from({ length: 7 }, (_, index) => (
      <span className={styles.skeleton} key={index} />
    ))
    return (
      <Typography as="div" className={styles.statisticsLoading} role="status" aria-label={t('profile.statistics.loading')}>
        {skeletons}
      </Typography>
    )
  }

  if (statistics.isError) {
    return (
      <div className={styles.statisticsError}>
        <Typography role="alert">{t('profile.statistics.failed')}</Typography>
        <Button type="button" variant="outline" onClick={() => void statistics.refetch()}>
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.7} aria-hidden="true" />
          {t('profile.statistics.retry')}
        </Button>
      </div>
    )
  }

  const data = statistics.data
  const summary = [
    { label: t('profile.statistics.matches'), value: String(data.matchesPlayed) },
    { label: t('profile.statistics.wins'), value: String(data.wins) },
    { label: t('profile.statistics.winRate'), value: formatPercent(data.winRate) },
  ]
  const details = [
    { label: t('profile.statistics.averagePlacement'), value: formatAverage(data.averagePlacement) },
    { label: t('profile.statistics.averageRating'), value: formatAverage(data.averageRating) },
    { label: t('profile.statistics.modelAccuracy'), value: formatPercent(data.modelAccuracy) },
    { label: t('profile.statistics.contractSuccess'), value: formatPercent(data.contractSuccessRate) },
  ]

  return (
    <>
      <div className={styles.summary}>
        {summary.map((item) => (
          <div className={styles.summaryItem} key={item.label}>
            <Typography className={styles.summaryLabel}>{item.label}</Typography>
            <Typography className={styles.summaryValue}>{item.value}</Typography>
          </div>
        ))}
      </div>

      <section className={styles.details} aria-labelledby="profile-statistics-title">
        <Typography as="h3" id="profile-statistics-title" className={styles.detailsTitle}>
          {t('profile.statistics.title')}
        </Typography>
        <dl className={styles.detailsList}>
          {details.map((item) => (
            <div className={styles.detailRow} key={item.label}>
              <Typography as="dt" className={styles.detailLabel}>{item.label}</Typography>
              <Typography as="dd" className={styles.detailValue}>{item.value}</Typography>
            </div>
          ))}
        </dl>
        {data.matchesPlayed === 0 && (
          <Typography className={styles.emptyHint}>
            {t('profile.statistics.empty')}
          </Typography>
        )}
      </section>
    </>
  )
}

function formatAverage(value: number | null) {
  return value === null ? '—' : value.toFixed(1)
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function formatRegistrationDate(createdAt: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(createdAt)).replace(/\s*г\.$/, '')
}

function formatProtectionTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value)).replace(/\.$/, '')
}
