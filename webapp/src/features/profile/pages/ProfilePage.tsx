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
import { useMemo, useState } from 'react'

import { displayNameMaxLength, displayNameMinLength } from '@anomaly-detector/contracts'

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
import { useI18n } from '@/platform/i18n'

import { ProfileApi } from '../api'
import { useProfileStatisticsQuery } from '../queries'
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
