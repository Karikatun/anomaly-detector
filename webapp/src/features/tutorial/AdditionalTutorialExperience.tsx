import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { TutorialTenderBoard } from '@/features/tender/public/tutorial-board'
import { useI18n, type TranslationKey } from '@/platform/i18n'
import { advanceAdditionalTutorial, additionalTutorialView, createAdditionalTutorialState, type AdditionalAction, type AdditionalError, type AdditionalTutorialState } from './additional-scenario'
import { clearTutorialSession, getTutorialStorage, saveTutorialSession } from './session'
import { TutorialStateCard } from './TutorialStateCard'
import styles from './AdditionalTutorialExperience.module.css'

export function AdditionalTutorialExperience({ initialState, onExit, onComplete, renderCompletion, storageNotice, exitLabel = 'tutorial.complete.home' }: {
  initialState: AdditionalTutorialState
  onExit: () => void
  onComplete?: (state: AdditionalTutorialState, signal: AbortSignal) => Promise<void>
  renderCompletion: (restart: () => void, state: AdditionalTutorialState) => ReactNode
  storageNotice?: string | null
  exitLabel?: TranslationKey
}) {
  const { t } = useI18n()
  const [state, setState] = useState(initialState)
  const current = useRef(initialState)
  const mounted = useRef(true)
  const [lesson, setLesson] = useState(() => new AbortController())
  const [storage] = useState(getTutorialStorage)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [error, setError] = useState<AdditionalError | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [boardEpoch, setBoardEpoch] = useState(0)
  const [laboratoryMode, setLaboratoryMode] = useState<'broad' | 'deep'>('deep')
  const exitButton = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => { current.current = state }, [state])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const apply = async (action: AdditionalAction) => {
    if (!mounted.current || lesson.signal.aborted) return
    const previous = current.current
    const result = advanceAdditionalTutorial(previous, action)
    current.current = result.state
    setState(result.state)
    if (result.state !== previous && !saveTutorialSession(storage, result.state)) setStorageUnavailable(true)
    setError(result.error ?? null)
    if (action.type === 'restart-checkpoint') {
      lesson.abort(); setLesson(new AbortController()); setBoardEpoch((epoch) => epoch + 1)
    }
    if (result.state.step === 'complete' && previous.step !== 'complete') await onComplete?.(result.state, lesson.signal)
    return result.error
  }
  const restart = () => {
    lesson.abort(); setLesson(new AbortController())
    clearTutorialSession(storage, state.playerId, 'additional')
    const next = createAdditionalTutorialState(state.playerId)
    saveTutorialSession(storage, next); setState(next); setError(null); setBoardEpoch((epoch) => epoch + 1)
  }
  if (state.step === 'complete') return renderCompletion(restart, state)
  if (state.step === 'intro') return <TutorialStateCard>
    <CardHeader><CardTitle><Typography as="h1" variant="h4">{t('tutorial.additional.intro.title')}</Typography></CardTitle></CardHeader>
    <CardContent className={styles.intro}>
      <Typography>{t('tutorial.additional.intro.description')}</Typography>
      <Typography>{t('tutorial.additional.intro.prepared')}</Typography>
      <Typography>{t('tutorial.additional.intro.given')}</Typography>
      {(storageUnavailable || storageNotice) && <Typography role="status">{storageNotice ?? t('tutorial.base.storage')}</Typography>}
      <div className={styles.actions}><Button onClick={() => void apply({ type: 'start-additional' })}>{t('tutorial.additional.start')}</Button><Button variant="outline" onClick={onExit}>{t(exitLabel)}</Button></div>
    </CardContent>
  </TutorialStateCard>

  const thesis = state.privateTheses.at(-1)
  const information = ['review-intro', 'review-result', 'contract-result', 'recovery-result', 'final-intro', 'final-contract-result'].includes(state.step)
  const resetAvailable = Boolean(state.checkpointInitial && (
    error || (state.step === 'thesis' && state.privateTheses.length > 0 && !thesis?.fullyCorrect)
      || (state.step === 'review-result' && !thesis?.fullyCorrect)
      || ['contracts', 'recovery-contracts', 'final-contract'].includes(state.step)
  ))
  return <>
    <Card className={styles.guidance} data-additional-step={state.step}>
      <CardHeader><CardTitle><Typography as="h1" variant="h5">{t(`tutorial.additional.scene.${state.step}.title`)}</Typography></CardTitle></CardHeader>
      <CardContent className={styles.guidanceContent}>
        <Typography>{t(state.step === 'review-thesis' && state.privateTheses.length > 0 ? 'tutorial.additional.reviewCorrection' : `tutorial.additional.scene.${state.step}.body`)}</Typography>
        {information && <Typography variant="bodySm">{t('tutorial.additional.resources', { budget: state.budget, rating: state.rating, trust: state.corporateTrust })}</Typography>}
        {(storageUnavailable || storageNotice) && <Typography role="status" variant="bodySm">{storageNotice ?? t('tutorial.base.storage')}</Typography>}
        {error && <Typography role="alert" tone="destructive">{t(`tutorial.additional.error.${error}`)}</Typography>}
        <div className={styles.actions}>
          {state.step === 'plan' && <><Button onClick={() => void apply({ type: 'choose-contract', contractId: 'lesson-light' })}>{t('tutorial.additional.planLight')}</Button><Button variant="outline" onClick={() => void apply({ type: 'choose-contract', contractId: 'lesson-scientific' })}>{t('tutorial.additional.planScientific')}</Button></>}
          {state.step === 'review-intro' && <Button onClick={() => void apply({ type: 'begin-review' })}>{t('tutorial.additional.beginReview')}</Button>}
          {state.step === 'review-result' && thesis?.fullyCorrect && <Button onClick={() => void apply({ type: 'continue-additional' })}>{t('tutorial.additional.returnMain')}</Button>}
          {state.step === 'contract-result' && state.ordinaryAccepted && <Button onClick={() => void apply({ type: 'begin-recovery' })}>{t('tutorial.additional.beginRecovery')}</Button>}
          {state.step === 'recovery-result' && <Button onClick={() => void apply({ type: 'continue-additional' })}>{t('tutorial.additional.returnMain')}</Button>}
          {state.step === 'final-intro' && <Button onClick={() => void apply({ type: 'prepare-final' })}>{t('tutorial.additional.prepareFinal')}</Button>}
          {state.step === 'final-contract-result' && <Button onClick={() => void apply({ type: 'continue-additional' })}>{t('tutorial.additional.beginFinalModel')}</Button>}
          {resetAvailable && <Button variant="outline" onClick={() => void apply({ type: 'restart-checkpoint' })}>{t('tutorial.additional.resetCheckpoint')}</Button>}
          <Button variant="ghost" ref={exitButton} onClick={() => setExitOpen(true)}>{t('tutorial.exit')}</Button>
        </div>
      </CardContent>
    </Card>
    {!information && <TutorialTenderBoard key={`${boardEpoch}:${state.checkpointKind}`} view={additionalTutorialView(state)}
      documentFlow lessonLabel="tutorial.additional.boardLabel" actionPanelPinned={false} commandError={error ? t(`tutorial.additional.error.${error}`) : null} highlight="none" interpretationRequired={state.step === 'plan'}
      laboratoryInitialMode={laboratoryMode} onLaboratoryModeSelected={setLaboratoryMode}
      onCommand={async (command) => { const rejected = await apply(command); if (rejected) throw new Error(rejected) }}
      onSaveWorkingModel={async (workingModel) => (await apply({ type: 'update-working-model', workingModel })) === undefined}
      onJournalClosed={(workingModel) => void apply({ type: 'update-working-model', workingModel })}
      onExitRequest={() => setExitOpen(true)} onContractsClosed={() => undefined} onContractsOpened={() => undefined}
      onDirectInterpretationOpened={() => undefined} onHelpMenuOpened={() => undefined} onInterpretationOpened={() => undefined}
      onJournalOpenChange={() => undefined} onWorkingModelOpened={() => undefined} onResearchOpened={() => undefined} onRequiredModalOpenChange={() => undefined}
    />}
    <Dialog open={exitOpen} onOpenChange={setExitOpen}>
      <DialogContent onCloseAutoFocus={(event) => { if (exitButton.current?.isConnected) { event.preventDefault(); exitButton.current.focus({ preventScroll: true }) } }}>
        <DialogHeader><DialogTitle>{t('tutorial.exit.title')}</DialogTitle><DialogDescription>{t('tutorial.additional.exitDescription')}</DialogDescription></DialogHeader>
        <div className={styles.actions}><Button variant="outline" onClick={() => setExitOpen(false)}>{t('tutorial.exit.cancel')}</Button><Button onClick={() => { lesson.abort(); clearTutorialSession(storage, state.playerId, 'additional'); onExit() }}>{t('tutorial.exit.confirm')}</Button></div>
      </DialogContent>
    </Dialog>
  </>
}
