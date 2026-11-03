import type { TutorialLessonId, TutorialProgressCommand } from '@anomaly-detector/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { AuthSessionGate, ProtectedPage, useAuth } from '@/features/auth'
import { ProfileApi, useAccountProtectionQuery, useRecordTutorialProgressMutation, useTutorialLessonsProgressQuery } from '@/features/profile'
import { CreateRoomDialog, RoomsApi, useCurrentMatchQuery } from '@/features/rooms'
import { useI18n } from '@/platform/i18n'
import { getPublicWebsiteUrl } from '@/platform/public-website-url'
import { baseScenarioVersion, createTutorialState, type TutorialState } from './scenario'
import { additionalScenarioVersion, createAdditionalTutorialState, type AdditionalTutorialState } from './additional-scenario'
import { beginGuestTutorialHandoff, claimGuestTutorialHandoff, finishGuestTutorialHandoff, getTutorialStorage, guestTutorialPlayerId, loadTutorialSessionResult, clearTutorialSession } from './session'
import { TutorialExperience } from './TutorialExperience'
import { AdditionalTutorialExperience } from './AdditionalTutorialExperience'
import { TutorialStateCard } from './TutorialStateCard'
import styles from './TutorialPage.module.css'

type LessonState = TutorialState | AdditionalTutorialState
function createLessonState(playerId: string, lessonId: TutorialLessonId): LessonState {
  return lessonId === 'base' ? createTutorialState(playerId) : createAdditionalTutorialState(playerId)
}
function completionCommand(lessonId: TutorialLessonId): TutorialProgressCommand {
  return lessonId === 'base' ? { kind: 'scenario-completed', lessonId, scenarioVersion: baseScenarioVersion } : { kind: 'scenario-completed', lessonId, scenarioVersion: additionalScenarioVersion }
}
function useSelectedLesson(): TutorialLessonId {
  const search = useSearch({ strict: false })
  return 'lesson' in search && search.lesson === 'additional' ? 'additional' : 'base'
}
export function TutorialPage() {
  const lessonId = useSelectedLesson()
  return <ProtectedPage><AuthenticatedTutorial entry="account" lessonId={lessonId} /></ProtectedPage>
}
export function GuestTutorialPage() {
  const lessonId = useSelectedLesson()
  return <AuthSessionGate anonymous={<GuestTutorial key={lessonId} lessonId={lessonId} />}>{() => <AuthenticatedTutorial entry="public" lessonId={lessonId} />}</AuthSessionGate>
}
function AuthenticatedTutorial({ entry, lessonId }: { entry: 'public' | 'account'; lessonId: TutorialLessonId }) {
  const auth = useAuth()
  return auth.user ? <AccountTutorial key={auth.user.id + ':' + lessonId} playerId={auth.user.id} entry={entry} lessonId={lessonId} /> : null
}
function AccountTutorial({ playerId, entry, lessonId }: { playerId: string; entry: 'public' | 'account'; lessonId: TutorialLessonId }) {
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
    const handoff = claimGuestTutorialHandoff(storage, playerId, lessonId)
    const loaded = loadTutorialSessionResult(storage, playerId, lessonId)
    const command = handoff?.command ?? loaded.completionCommand ?? (lessonId === 'base' && loaded.legacyCompleted ? { kind: 'legacy-credit' as const } : null)
    return { ...loaded, handoff, command }
  })
  const [initialRun, setInitialRun] = useState<LessonState>(entryState.state)
  const [entryCompletion, setEntryCompletion] = useState(Boolean(entryState.command))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>(entryState.command ? 'pending' : 'idle')
  const [completionKind, setCompletionKind] = useState(entryState.command?.kind ?? 'scenario-completed')
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const saveState = useRef<'idle' | 'pending' | 'saved'>('idle')
  const saveAttempt = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; saveAttempt.current?.abort(); saveAttempt.current = null; saveState.current = 'idle' }
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
      if (entryState.handoff) finishGuestTutorialHandoff(storage, playerId, entryState.handoff.handoffId, lessonId)
      saveState.current = 'saved'; setSaveStatus('saved')
    }, () => {
      if (!isCurrent()) return
      saveState.current = 'idle'; setSaveStatus('error')
    }).finally(() => signal?.removeEventListener('abort', cancel))
  }, [entryState.handoff, lessonId, playerId, recordProgress, storage])
  useEffect(() => {
    if (!currentMatch.isPending && !currentMatch.isError && !currentMatch.data && entryCompletion && entryState.command) void persist(entryState.command)
  }, [currentMatch.data, currentMatch.isError, currentMatch.isPending, entryCompletion, entryState.command, persist])
  const returnToMatch = () => {
    const match = currentMatch.data
    if (!match) return
    if (match.status === 'started' && match.tenderId) void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId }, search: { from: undefined } })
    else void navigate({ to: '/rooms/$roomId', params: { roomId: match.roomId } })
  }
  const onComplete = (_state: LessonState, signal: AbortSignal) => {
    setSaveStatus('pending'); setCompletionKind('scenario-completed')
    return persist(completionCommand(lessonId), signal)
  }
  const repeat = (restart?: () => void) => {
    saveAttempt.current?.abort(); saveAttempt.current = null; saveState.current = 'idle'
    setSaveStatus('idle'); setCompletionKind('scenario-completed')
    if (restart) restart()
    else { clearTutorialSession(storage, playerId, lessonId); setInitialRun(createLessonState(playerId, lessonId)); setEntryCompletion(false) }
  }
  const retrySave = useCallback(() => {
    setSaveStatus('pending')
    void persist(completionKind === 'legacy-credit' && lessonId === 'base' ? { kind: 'legacy-credit' } : completionCommand(lessonId))
  }, [completionKind, lessonId, persist])
  const renderCompletion = (restart: (() => void) | undefined, state: LessonState) => {
    const legacy = lessonId === 'base' && completionKind === 'legacy-credit' && !progress.data?.base.completion
    const saved = saveStatus === 'saved'
    const actual = progress.data?.[lessonId].completion
    const legacyCredit = lessonId === 'base' ? progress.data?.base.legacyCredit : null
    return <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
      <CardHeader><CardTitle>{t(saved ? legacy ? 'tutorial.base.legacy' : lessonId === 'base' ? 'tutorial.complete.title' : 'tutorial.additional.complete.title' : saveStatus === 'error' ? 'tutorial.complete.saveErrorTitle' : 'tutorial.complete.savingTitle')}</CardTitle></CardHeader>
      <CardContent className={styles.completeContent}>
        <Typography>{t(legacy ? 'tutorial.base.legacyDescription' : lessonId === 'base' ? 'tutorial.complete.description' : 'tutorial.additional.complete.description')}</Typography>
        {!legacy && state.finalSubmission && <><Typography>{state.lessonId === 'base' ? t('tutorial.base.result', { score: state.rating }) : t('tutorial.additional.complete.result', { rating: state.rating, score: state.modelScore })}</Typography><Typography>{t('tutorial.base.resultPartial')}</Typography></>}
        {actual && <Typography>{t(lessonId === 'base' ? 'tutorial.base.actualDate' : 'tutorial.lessonMenu.additionalDate', { date: new Date(actual.completedAt).toLocaleDateString('ru-RU') })}</Typography>}
        {legacyCredit && <Typography>{t('tutorial.base.legacyDate', { date: legacyCredit.completedAt ? new Date(legacyCredit.completedAt).toLocaleDateString('ru-RU') : t('tutorial.base.unknownDate') })}</Typography>}
        {saveStatus === 'pending' && <Typography role="status">{t('tutorial.complete.savingDescription')}</Typography>}
        {saveStatus === 'error' && <div className={styles.saveError} role="alert"><Typography>{t('tutorial.complete.saveError')}</Typography><Button onClick={retrySave}>{t('tutorial.complete.retrySave')}</Button></div>}
        <Typography>{t(lessonId === 'base' ? 'tutorial.complete.realMatch' : 'tutorial.additional.complete.realMatch')}</Typography>
        <Typography>{t('tutorial.complete.nextMatch')}</Typography>
        <div className={styles.completeActions}>
          <Button onClick={() => setCreateRoomOpen(true)}>{t('tutorial.complete.create')}</Button>
          <Button variant="outline" onClick={exitTutorial}>{t(entry === 'public' ? 'tutorial.guest.website' : 'tutorial.complete.home')}</Button>
          <Button variant="ghost" onClick={() => { if (restart) restart(); else repeat() }}>{t(legacy ? 'tutorial.base.startNew' : 'tutorial.complete.repeat')}</Button>
        </div>
        {saved && accountProtection.isSuccess && accountProtection.data.accountProtection.state === 'password_unprotected' && <section className={styles.accountProtectionInvitation} aria-labelledby="tutorial-account-protection-title"><Typography as="h2" id="tutorial-account-protection-title">{t('tutorial.complete.accountProtection.title')}</Typography><Typography>{t('tutorial.complete.accountProtection.description')}</Typography><Typography>{t('tutorial.complete.accountProtection.warning')}</Typography><Button variant="outline" onClick={() => void navigate({ to: '/profile', hash: 'account-protection' })}>{t('tutorial.complete.accountProtection.action')}</Button></section>}
        <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} initialMode={lessonId === 'base' ? 'simple' : 'standard'} />
      </CardContent>
    </TutorialStateCard>
  }
  if (currentMatch.isPending) return <TutorialStateCard><CardContent className={styles.stateLoading} role="status"><Spinner /><Typography>{t('tutorial.loading')}</Typography></CardContent></TutorialStateCard>
  if (currentMatch.isError) return <TutorialStateCard><CardHeader><CardTitle role="alert">{t('tutorial.loadError')}</CardTitle></CardHeader><CardContent><Button onClick={() => void currentMatch.refetch()}>{t('tutorial.retry')}</Button></CardContent></TutorialStateCard>
  if (currentMatch.data) return <TutorialStateCard><CardHeader><CardTitle>{t('tutorial.blocked.title')}</CardTitle></CardHeader><CardContent className={styles.stateContent}><Typography>{t('tutorial.blocked.description')}</Typography><Button onClick={returnToMatch}>{t('tutorial.blocked.return')}</Button></CardContent></TutorialStateCard>
  if (entryCompletion) return renderCompletion(undefined, entryState.state)
  const common = { onComplete, onExit: exitTutorial, storageNotice: entryState.notice === 'storage-unavailable' ? t('tutorial.base.storage') : entryState.notice === 'legacy-restart' ? t('tutorial.base.updated') : null, renderCompletion: (restart: () => void, state: LessonState) => renderCompletion(() => repeat(restart), state) }
  return initialRun.lessonId === 'base' ? <TutorialExperience initialState={initialRun} {...common} exitLabel={entry === 'public' ? 'tutorial.guest.website' : 'tutorial.prologue.home'} /> : <AdditionalTutorialExperience initialState={initialRun} {...common} exitLabel={entry === 'public' ? 'tutorial.guest.website' : 'tutorial.complete.home'} />
}
function GuestTutorial({ lessonId }: { lessonId: TutorialLessonId }) {
  const { t } = useI18n()
  const [storage] = useState(getTutorialStorage)
  const [loaded] = useState(() => loadTutorialSessionResult(storage, guestTutorialPlayerId, lessonId))
  const [legacy, setLegacy] = useState(lessonId === 'base' && loaded.legacyCompleted)
  if (legacy) return <TutorialStateCard><CardHeader><CardTitle>{t('tutorial.base.legacy')}</CardTitle></CardHeader><CardContent className={styles.completeContent}><Typography>{t('tutorial.base.legacyDescription')}</Typography><div className={styles.completeActions}><GuestAuthButtons storage={storage} lessonId={lessonId} /><Button variant="ghost" onClick={() => { clearTutorialSession(storage, guestTutorialPlayerId, lessonId); setLegacy(false) }}>{t('tutorial.base.startNew')}</Button></div></CardContent></TutorialStateCard>
  const renderCompletion = (restart: () => void, state: LessonState) => <TutorialStateCard alignCardToTop showExpeditionBackground={false}>
    <CardHeader><Typography as="h1" variant="h4">{t(lessonId === 'base' ? 'tutorial.complete.title' : 'tutorial.additional.complete.title')}</Typography></CardHeader>
    <CardContent className={styles.completeContent}>
      <Typography>{t(lessonId === 'base' ? 'tutorial.complete.description' : 'tutorial.additional.complete.description')}</Typography>
      <Typography>{state.lessonId === 'base' ? t('tutorial.base.result', { score: state.rating }) : t('tutorial.additional.complete.result', { rating: state.rating, score: state.modelScore })}</Typography>
      <Typography>{t('tutorial.base.resultPartial')}</Typography>
      <Typography>{t(lessonId === 'base' ? 'tutorial.complete.realMatch' : 'tutorial.additional.complete.realMatch')}</Typography>
      <Typography>{t('tutorial.guest.next')}</Typography>
      {loaded.notice === 'storage-unavailable' && <Typography role="status">{t('tutorial.base.storage')}</Typography>}
      <div className={styles.completeActions}><GuestAuthButtons storage={storage} lessonId={lessonId} /><Button variant="ghost" onClick={restart}>{t('tutorial.complete.repeat')}</Button></div>
    </CardContent>
  </TutorialStateCard>
  const common = { onExit: () => window.location.assign(getPublicWebsiteUrl()), storageNotice: loaded.notice === 'storage-unavailable' ? t('tutorial.base.storage') : loaded.notice === 'legacy-restart' ? t('tutorial.base.updated') : null, renderCompletion }
  return loaded.state.lessonId === 'base' ? <TutorialExperience initialState={loaded.state} {...common} exitLabel="tutorial.guest.website" /> : <AdditionalTutorialExperience initialState={loaded.state} {...common} exitLabel="tutorial.guest.website" />
}
function GuestAuthButtons({ storage, lessonId }: { storage: Storage | undefined; lessonId: TutorialLessonId }) {
  const { t } = useI18n()
  const intent = lessonId === 'base' ? 'tutorial-complete' : 'tutorial-additional-complete'
  return <>
    <Button asChild><a href={'/?continue=' + intent} onClick={(event) => {
      event.preventDefault(); window.location.assign(beginGuestTutorialHandoff(storage, lessonId) ? '/?continue=' + intent : '/?auth=register')
    }}><Typography as="span" variant="controlWrap">{t('tutorial.guest.register')}</Typography></a></Button>
    <Button variant="outline" asChild><a href={'/?continue=' + intent + '&auth=login'} onClick={(event) => {
      event.preventDefault(); window.location.assign(beginGuestTutorialHandoff(storage, lessonId) ? '/?continue=' + intent + '&auth=login' : '/?auth=login')
    }}><Typography as="span" variant="controlWrap">{t('tutorial.guest.existingAccount')}</Typography></a></Button>
  </>
}
