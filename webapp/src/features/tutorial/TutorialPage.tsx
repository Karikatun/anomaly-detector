import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { AuthSessionGate, ProtectedPage, useAuth } from '@/features/auth'
import { ProfileApi, useAccountProtectionQuery, useCompleteTutorialMutation } from '@/features/profile'
import { CreateRoomDialog, RoomsApi, useCurrentMatchQuery } from '@/features/rooms'
import { useI18n } from '@/platform/i18n'
import { getPublicWebsiteUrl } from '@/platform/public-website-url'
import { createTutorialState, type TutorialState } from './scenario'
import {
  beginGuestTutorialHandoff,
  claimGuestTutorialCompletion,
  finishGuestTutorialHandoff,
  guestTutorialPlayerId,
  loadTutorialSession,
  saveTutorialSession,
} from './session'
import { TutorialExperience } from './TutorialExperience'
import { TutorialStateCard } from './TutorialStateCard'
import styles from './TutorialPage.module.css'

export function TutorialPage() {
  return <ProtectedPage><AuthenticatedTutorial entry="account" /></ProtectedPage>
}

export function GuestTutorialPage() {
  return (
    <AuthSessionGate anonymous={<GuestTutorial />}>
      {() => <AuthenticatedTutorial entry="public" />}
    </AuthSessionGate>
  )
}

function AuthenticatedTutorial({ entry }: { entry: 'public' | 'account' }) {
  const auth = useAuth()
  // Remount the local scenario when the authenticated account changes.
  return auth.user ? <AccountTutorial key={auth.user.id} playerId={auth.user.id} entry={entry} /> : null
}

function AccountTutorial({ playerId, entry }: { playerId: string; entry: 'public' | 'account' }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const roomsApi = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const profileApi = useMemo(() => new ProfileApi(auth.transport), [auth.transport])
  const currentMatch = useCurrentMatchQuery(roomsApi)
  const completeTutorial = useCompleteTutorialMutation(profileApi)
  const { mutateAsync } = completeTutorial
  const [initialState] = useState<TutorialState>(() => {
    if (claimGuestTutorialCompletion(sessionStorage, playerId)) {
      // Only the completion marker crosses into the account; guest scores and models do not.
      const completed: TutorialState = { ...createTutorialState(playerId), step: 'complete' }
      saveTutorialSession(sessionStorage, completed)
      return completed
    }
    return loadTutorialSession(sessionStorage, playerId)
  })
  const [completionSaveStatus, setCompletionSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>(
    initialState.step === 'complete' ? 'pending' : 'idle',
  )
  const saveState = useRef<'idle' | 'pending' | 'saved'>('idle')
  const accountProtection = useAccountProtectionQuery(profileApi, completionSaveStatus === 'saved')
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const exitTutorial = () => {
    if (entry === 'public') window.location.assign(getPublicWebsiteUrl())
    else void navigate({ to: '/' })
  }

  const persistCompletion = useCallback(() => {
    if (saveState.current !== 'idle') return Promise.resolve()
    saveState.current = 'pending'
    return mutateAsync().then(() => {
      finishGuestTutorialHandoff(sessionStorage, playerId)
      saveState.current = 'saved'
      setCompletionSaveStatus('saved')
    }, () => {
      saveState.current = 'idle'
      setCompletionSaveStatus('error')
    })
  }, [mutateAsync, playerId])

  useEffect(() => {
    if (initialState.step === 'complete') void persistCompletion()
  }, [initialState.step, persistCompletion])

  const saveCompletion = async () => {
    setCompletionSaveStatus('pending')
    await persistCompletion()
  }

  const returnToCurrentMatch = () => {
    const match = currentMatch.data
    if (!match) return
    if (match.status === 'started' && match.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId }, search: { from: undefined } })
    } else {
      void navigate({ to: '/rooms/$roomId', params: { roomId: match.roomId } })
    }
  }

  const renderCompletion = (restart: () => void) => {
    const completionSaved = completionSaveStatus === 'saved'
    const completionFailed = completionSaveStatus === 'error'
    const showAccountProtectionInvitation = completionSaved
      && accountProtection.isSuccess
      && !accountProtection.isFetching
      && accountProtection.data.accountProtection.state === 'password_unprotected'
    return (
      <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
        <CardHeader>
          <CardTitle>
            {t(completionSaved
              ? 'tutorial.complete.title'
              : completionFailed
                ? 'tutorial.complete.saveErrorTitle'
                : 'tutorial.complete.savingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.completeContent}>
          {completionSaved ? (
            <>
              <Typography>{t('tutorial.complete.description')}</Typography>
              <Typography>{t('tutorial.complete.nextMatch')}</Typography>
            </>
          ) : !completionFailed ? (
            <Typography tone="muted">{t('tutorial.complete.savingDescription')}</Typography>
          ) : null}
          {completionFailed && (
            <div className={styles.saveError} role="alert">
              <Typography variant="bodySm" tone="destructive">{t('tutorial.complete.saveError')}</Typography>
              <Button
                variant="outline"
                onClick={() => void saveCompletion()}
              >
                {t('tutorial.complete.retrySave')}
              </Button>
            </div>
          )}
          {completionSaved && (
            <div className={styles.completeActions}>
              <Button onClick={() => setCreateRoomOpen(true)}>{t('tutorial.complete.create')}</Button>
              <Button variant="outline" onClick={exitTutorial}>{t(entry === 'public' ? 'tutorial.guest.website' : 'tutorial.complete.home')}</Button>
              <Button variant="ghost" onClick={() => {
                saveState.current = 'idle'
                setCompletionSaveStatus('idle')
                restart()
              }}>{t('tutorial.complete.repeat')}</Button>
            </div>
          )}
          {completionSaved && (
            <>
              <Typography tone="muted">{t('tutorial.complete.contracts')}</Typography>
              <Typography tone="muted">{t('tutorial.complete.realMatch')}</Typography>
            </>
          )}
          {showAccountProtectionInvitation && (
            <section
              className={styles.accountProtectionInvitation}
              aria-labelledby="tutorial-account-protection-title"
            >
              <div className={styles.accountProtectionCopy}>
                <Typography
                  as="h2"
                  id="tutorial-account-protection-title"
                  variant="h6"
                >
                  {t('tutorial.complete.accountProtection.title')}
                </Typography>
                <Typography tone="muted">
                  {t('tutorial.complete.accountProtection.description')}
                </Typography>
                <Typography variant="bodySm" className={styles.accountProtectionWarning}>
                  {t('tutorial.complete.accountProtection.warning')}
                </Typography>
              </div>
              <Button
                type="button"
                variant="outline"
                className={styles.accountProtectionAction}
                onClick={() => void navigate({ to: '/profile', hash: 'account-protection' })}
              >
                {t('tutorial.complete.accountProtection.action')}
              </Button>
            </section>
          )}
          <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} />
        </CardContent>
      </TutorialStateCard>
    )
  }

  if (currentMatch.isPending) {
    return (
      <TutorialStateCard>
        <CardContent className={styles.stateLoading} role="status">
          <Spinner />
          <Typography variant="bodySm" tone="muted">{t('tutorial.loading')}</Typography>
        </CardContent>
      </TutorialStateCard>
    )
  }
  if (currentMatch.isError) {
    return (
      <TutorialStateCard>
        <CardHeader><CardTitle role="alert">{t('tutorial.loadError')}</CardTitle></CardHeader>
        <CardContent className={styles.stateContent}>
          <Button onClick={() => void currentMatch.refetch()}>{t('tutorial.retry')}</Button>
        </CardContent>
      </TutorialStateCard>
    )
  }
  if (currentMatch.data) {
    return (
      <TutorialStateCard>
        <CardHeader><CardTitle>{t('tutorial.blocked.title')}</CardTitle></CardHeader>
        <CardContent className={styles.stateContent}>
          <Typography tone="muted">{t('tutorial.blocked.description')}</Typography>
          <Button onClick={returnToCurrentMatch}>{t('tutorial.blocked.return')}</Button>
        </CardContent>
      </TutorialStateCard>
    )
  }

  return (
    <TutorialExperience
      initialState={initialState}
      onComplete={saveCompletion}
      onExit={exitTutorial}
      exitLabel={entry === 'public' ? 'tutorial.guest.website' : 'tutorial.prologue.home'}
      renderCompletion={renderCompletion}
    />
  )
}

function GuestTutorial() {
  const { t } = useI18n()
  const [initialState] = useState(() => loadTutorialSession(sessionStorage, guestTutorialPlayerId))
  return (
    <TutorialExperience
      initialState={initialState}
      onExit={() => window.location.assign(getPublicWebsiteUrl())}
      exitLabel="tutorial.guest.website"
      renderCompletion={(restart) => (
        <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
          <CardHeader>
            <Typography as="h1" variant="h4">{t('tutorial.complete.title')}</Typography>
          </CardHeader>
          <CardContent className={styles.completeContent}>
            <Typography>{t('tutorial.complete.description')}</Typography>
            <Typography>{t('tutorial.guest.next')}</Typography>
            <div className={styles.completeActions}>
              <Button asChild>
                <a href="/?continue=tutorial-complete" onClick={() => beginGuestTutorialHandoff(sessionStorage)}>
                  <Typography as="span" variant="control">{t('tutorial.guest.register')}</Typography>
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/?continue=tutorial-complete&auth=login" onClick={() => beginGuestTutorialHandoff(sessionStorage)}>
                  <Typography as="span" variant="control">{t('tutorial.guest.existingAccount')}</Typography>
                </a>
              </Button>
              <Button variant="ghost" onClick={restart}>{t('tutorial.complete.repeat')}</Button>
            </div>
            <Typography tone="muted">{t('tutorial.complete.realMatch')}</Typography>
          </CardContent>
        </TutorialStateCard>
      )}
    />
  )
}
