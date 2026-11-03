import type { TutorialProgressCommand } from '@anomaly-detector/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { AuthSessionGate, ProtectedPage, useAuth } from '@/features/auth'
import { ProfileApi, useAccountProtectionQuery, useRecordTutorialProgressMutation, useTutorialLessonsProgressQuery } from '@/features/profile'
import { CreateRoomDialog, RoomsApi, useCurrentMatchQuery } from '@/features/rooms'
import { useI18n } from '@/platform/i18n'
import { getPublicWebsiteUrl } from '@/platform/public-website-url'
import { baseScenarioVersion, createTutorialState } from './scenario'
import { beginGuestTutorialHandoff, claimGuestTutorialHandoff, finishGuestTutorialHandoff, getTutorialStorage, guestTutorialPlayerId, loadTutorialSessionResult, clearTutorialSession } from './session'
import { TutorialExperience } from './TutorialExperience'
import { TutorialStateCard } from './TutorialStateCard'
import styles from './TutorialPage.module.css'

const baseCompletionCommand: TutorialProgressCommand = { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: baseScenarioVersion }
export function TutorialPage() { return <ProtectedPage><AuthenticatedTutorial entry="account" /></ProtectedPage> }
export function GuestTutorialPage() {
  return <AuthSessionGate anonymous={<GuestTutorial />}>{() => <AuthenticatedTutorial entry="public" />}</AuthSessionGate>
}
function AuthenticatedTutorial({ entry }: { entry: 'public' | 'account' }) {
  const auth = useAuth()
  return auth.user ? <AccountTutorial key={auth.user.id} playerId={auth.user.id} entry={entry} /> : null
}
function AccountTutorial({ playerId, entry }: { playerId: string; entry: 'public' | 'account' }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [storage] = useState(getTutorialStorage)
  const roomsApi = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const profileApi = useMemo(() => new ProfileApi(auth.transport), [auth.transport])
  const currentMatch = useCurrentMatchQuery(roomsApi)
  const progress = useTutorialLessonsProgressQuery(profileApi)
  const { mutateAsync: recordProgress } = useRecordTutorialProgressMutation(profileApi)
  const [entryState] = useState(() => {
    const handoff = claimGuestTutorialHandoff(storage, playerId)
    const loaded = loadTutorialSessionResult(storage, playerId)
    const command = handoff?.command ?? loaded.completionCommand ?? (loaded.legacyCompleted ? { kind: 'legacy-credit' as const } : null)
    return { ...loaded, handoff, command, state: command && loaded.state.step !== 'complete' ? { ...createTutorialState(playerId), step: 'complete' as const } : loaded.state }
  })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>(entryState.command ? 'pending' : 'idle')
  const [completionKind, setCompletionKind] = useState(entryState.command?.kind ?? 'scenario-completed')
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const saveState = useRef<'idle' | 'pending' | 'saved'>('idle')
  const saveAttempt = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      saveAttempt.current?.abort()
      saveAttempt.current = null
      saveState.current = 'idle'
    }
  }, [])
  const accountProtection = useAccountProtectionQuery(profileApi, saveStatus === 'saved')
  const exitTutorial = () => entry === 'public' ? window.location.assign(getPublicWebsiteUrl()) : void navigate({ to: '/' })
  const persist = useCallback((command: TutorialProgressCommand, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted || !mounted.current || saveState.current !== 'idle') return Promise.resolve()
    const attempt = new AbortController()
    saveAttempt.current = attempt
    const cancel = () => attempt.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const isCurrent = () => mounted.current && saveAttempt.current === attempt && !attempt.signal.aborted
    saveState.current = 'pending'
    return recordProgress(command).then(() => {
      if (!isCurrent()) return
      if (entryState.handoff) finishGuestTutorialHandoff(storage, playerId, entryState.handoff.handoffId)
      saveState.current = 'saved'
      setSaveStatus('saved')
    }, () => {
      if (!isCurrent()) return
      saveState.current = 'idle'
      setSaveStatus('error')
    }).finally(() => signal?.removeEventListener('abort', cancel))
  }, [entryState.handoff, playerId, recordProgress, storage])
  useEffect(() => {
    if (!currentMatch.isPending && !currentMatch.isError && !currentMatch.data && entryState.command) void persist(entryState.command)
  }, [currentMatch.data, currentMatch.isError, currentMatch.isPending, entryState.command, persist])
  const returnToMatch = () => {
    const match = currentMatch.data
    if (!match) return
    if (match.status === 'started' && match.tenderId) void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId }, search: { from: undefined } })
    else void navigate({ to: '/rooms/$roomId', params: { roomId: match.roomId } })
  }
  if (currentMatch.isPending) return <TutorialStateCard><CardContent className={styles.stateLoading} role="status"><Spinner /><Typography>{t('tutorial.loading')}</Typography></CardContent></TutorialStateCard>
  if (currentMatch.isError) return <TutorialStateCard><CardHeader><CardTitle role="alert">{t('tutorial.loadError')}</CardTitle></CardHeader><CardContent><Button onClick={() => void currentMatch.refetch()}>{t('tutorial.retry')}</Button></CardContent></TutorialStateCard>
  if (currentMatch.data) return <TutorialStateCard><CardHeader><CardTitle>{t('tutorial.blocked.title')}</CardTitle></CardHeader><CardContent className={styles.stateContent}><Typography>{t('tutorial.blocked.description')}</Typography><Button onClick={returnToMatch}>{t('tutorial.blocked.return')}</Button></CardContent></TutorialStateCard>
  return <TutorialExperience
    initialState={entryState.state}
    onExit={exitTutorial}
    exitLabel={entry === 'public' ? 'tutorial.guest.website' : 'tutorial.prologue.home'}
    storageNotice={entryState.notice === 'storage-unavailable' ? t('tutorial.base.storage') : entryState.notice === 'legacy-restart' ? t('tutorial.base.updated') : null}
    onComplete={(_state, signal) => { setSaveStatus('pending'); setCompletionKind('scenario-completed'); return persist(baseCompletionCommand, signal) }}
    renderCompletion={(restart, state) => {
      const legacy = completionKind === 'legacy-credit' && !progress.data?.base.completion
      const saved = saveStatus === 'saved'
      return <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
        <CardHeader><CardTitle>{t(saved ? legacy ? 'tutorial.base.legacy' : 'tutorial.complete.title' : saveStatus === 'error' ? 'tutorial.complete.saveErrorTitle' : 'tutorial.complete.savingTitle')}</CardTitle></CardHeader>
        <CardContent className={styles.completeContent}>
          <Typography>{t(legacy ? 'tutorial.base.legacyDescription' : 'tutorial.complete.description')}</Typography>
          {!legacy && state.finalSubmission && <><Typography>{t('tutorial.base.result', { score: state.rating })}</Typography><Typography>{t('tutorial.base.resultPartial')}</Typography></>}
          {progress.data?.base.completion && <Typography>{t('tutorial.base.actualDate', { date: new Date(progress.data.base.completion.completedAt).toLocaleDateString('ru-RU') })}</Typography>}
          {progress.data?.base.legacyCredit && <Typography>{t('tutorial.base.legacyDate', { date: progress.data.base.legacyCredit.completedAt ? new Date(progress.data.base.legacyCredit.completedAt).toLocaleDateString('ru-RU') : t('tutorial.base.unknownDate') })}</Typography>}
          {saveStatus === 'pending' && <Typography role="status">{t('tutorial.complete.savingDescription')}</Typography>}
          {saveStatus === 'error' && <div className={styles.saveError} role="alert"><Typography>{t('tutorial.complete.saveError')}</Typography><Button onClick={() => { setSaveStatus('pending'); void persist(legacy ? { kind: 'legacy-credit' } : baseCompletionCommand) }}>{t('tutorial.complete.retrySave')}</Button></div>}
          <Typography>{t('tutorial.complete.realMatch')}</Typography>
          <Typography>{t('tutorial.complete.nextMatch')}</Typography>
          <div className={styles.completeActions}>
            <Button onClick={() => setCreateRoomOpen(true)}>{t('tutorial.complete.create')}</Button>
            <Button variant="outline" onClick={exitTutorial}>{t(entry === 'public' ? 'tutorial.guest.website' : 'tutorial.complete.home')}</Button>
            <Button variant="ghost" onClick={() => { saveAttempt.current?.abort(); saveAttempt.current = null; saveState.current = 'idle'; setSaveStatus('idle'); setCompletionKind('scenario-completed'); restart() }}>{t(legacy ? 'tutorial.base.startNew' : 'tutorial.complete.repeat')}</Button>
          </div>
          {saved && accountProtection.isSuccess && accountProtection.data.accountProtection.state === 'password_unprotected' && <section className={styles.accountProtectionInvitation} aria-labelledby="tutorial-account-protection-title"><Typography as="h2" id="tutorial-account-protection-title">{t('tutorial.complete.accountProtection.title')}</Typography><Typography>{t('tutorial.complete.accountProtection.description')}</Typography><Typography>{t('tutorial.complete.accountProtection.warning')}</Typography><Button variant="outline" onClick={() => void navigate({ to: '/profile', hash: 'account-protection' })}>{t('tutorial.complete.accountProtection.action')}</Button></section>}
          <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} initialMode="simple" />
        </CardContent>
      </TutorialStateCard>
    }}
  />
}
function GuestTutorial() {
  const { t } = useI18n()
  const [storage] = useState(getTutorialStorage)
  const [loaded] = useState(() => loadTutorialSessionResult(storage, guestTutorialPlayerId))
  const [legacy, setLegacy] = useState(loaded.legacyCompleted)
  if (legacy) return <TutorialStateCard><CardHeader><CardTitle>{t('tutorial.base.legacy')}</CardTitle></CardHeader><CardContent className={styles.completeContent}><Typography>{t('tutorial.base.legacyDescription')}</Typography><div className={styles.completeActions}><GuestAuthButtons storage={storage} /><Button variant="ghost" onClick={() => { clearTutorialSession(storage, guestTutorialPlayerId); setLegacy(false) }}>{t('tutorial.base.startNew')}</Button></div></CardContent></TutorialStateCard>
  return <TutorialExperience
    initialState={loaded.state}
    onExit={() => window.location.assign(getPublicWebsiteUrl())}
    exitLabel="tutorial.guest.website"
    storageNotice={loaded.notice === 'storage-unavailable' ? t('tutorial.base.storage') : loaded.notice === 'legacy-restart' ? t('tutorial.base.updated') : null}
    renderCompletion={(restart, state) => <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
      <CardHeader><Typography as="h1" variant="h4">{t('tutorial.complete.title')}</Typography></CardHeader>
      <CardContent className={styles.completeContent}>
        <Typography>{t('tutorial.complete.description')}</Typography>
        <Typography>{t('tutorial.base.result', { score: state.rating })}</Typography>
        <Typography>{t('tutorial.base.resultPartial')}</Typography>
        <Typography>{t('tutorial.complete.realMatch')}</Typography>
        <Typography>{t('tutorial.guest.next')}</Typography>
        {loaded.notice === 'storage-unavailable' && <Typography role="status">{t('tutorial.base.storage')}</Typography>}
        <div className={styles.completeActions}><GuestAuthButtons storage={storage} /><Button variant="ghost" onClick={restart}>{t('tutorial.complete.repeat')}</Button></div>
      </CardContent>
    </TutorialStateCard>}
  />
}

function GuestAuthButtons({ storage }: { storage: Storage | undefined }) {
  const { t } = useI18n()
  return <>
    <Button asChild><a href="/?continue=tutorial-complete" onClick={(event) => {
      event.preventDefault()
      window.location.assign(beginGuestTutorialHandoff(storage) ? '/?continue=tutorial-complete' : '/?auth=register')
    }}><Typography as="span" variant="control">{t('tutorial.guest.register')}</Typography></a></Button>
    <Button variant="outline" asChild><a href="/?continue=tutorial-complete&auth=login" onClick={(event) => {
      event.preventDefault()
      window.location.assign(beginGuestTutorialHandoff(storage) ? '/?continue=tutorial-complete&auth=login' : '/?auth=login')
    }}><Typography as="span" variant="control">{t('tutorial.guest.existingAccount')}</Typography></a></Button>
  </>
}
