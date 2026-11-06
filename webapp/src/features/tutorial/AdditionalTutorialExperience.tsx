import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { TutorialTenderBoard } from '@/features/tender/public/tutorial-board'
import { useI18n, type TranslationKey } from '@/platform/i18n'
import { advanceAdditionalTutorial, additionalTutorialView, createAdditionalTutorialState, type AdditionalAction, type AdditionalError, type AdditionalTutorialState } from './additional-scenario'
import { clearTutorialSession, type TutorialTimeline } from './session'
import { useTutorialTimeline } from './use-tutorial-timeline'
import { TutorialStateCard } from './TutorialStateCard'
import styles from './AdditionalTutorialExperience.module.css'

export function AdditionalTutorialExperience({ initialState, initialTimeline, onExit, onComplete, renderCompletion, storageNotice, exitLabel = 'tutorial.complete.home' }: {
  initialState: AdditionalTutorialState
  initialTimeline: TutorialTimeline<AdditionalTutorialState> | null
  onExit: () => void
  onComplete?: (state: AdditionalTutorialState, signal: AbortSignal) => Promise<void>
  renderCompletion: (restart: () => void, state: AdditionalTutorialState) => ReactNode
  storageNotice?: string | null
  exitLabel?: TranslationKey
}) {
  const { t } = useI18n()
  const timeline = useTutorialTimeline(initialState, initialTimeline)
  const { state, storage, storageUnavailable } = timeline
  const [lesson, setLesson] = useState(() => new AbortController())
  const [error, setError] = useState<AdditionalError | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [boardEpoch, setBoardEpoch] = useState(0)
  const [focusEpoch, setFocusEpoch] = useState(0)
  const [laboratoryMode, setLaboratoryMode] = useState<'broad' | 'deep'>('deep')
  const exitButton = useRef<HTMLButtonElement | null>(null)
  const guidance = useRef<HTMLDivElement>(null)
  const callbacksActive = () => timeline.isMounted() && !lesson.signal.aborted
  useLayoutEffect(() => {
    if (!focusEpoch) return
    const frame = requestAnimationFrame(() => {
      const target = guidance.current?.querySelector<HTMLElement>('[data-tutorial-back]:enabled') ?? guidance.current
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusEpoch])

  const resetBoard = () => {
    lesson.abort()
    setLesson(new AbortController())
    setBoardEpoch((epoch) => epoch + 1)
    setLaboratoryMode('deep')
    setError(null)
  }
  const apply = async (action: AdditionalAction) => {
    if (!callbacksActive()) return
    const previous = timeline.currentState()
    if (previous.step === 'complete') return
    const result = advanceAdditionalTutorial(previous, action)
    const reset = action.type === 'restart-checkpoint' && result.state !== previous
    if (reset || previous.checkpointKind !== result.state.checkpointKind) resetBoard()
    timeline.commit(result.state, reset ? 'reset' : 'advance')
    setError(result.error ?? null)
    if (result.state.step === 'complete') await onComplete?.(result.state, lesson.signal)
    return result.error
  }
  const back = () => {
    if (!callbacksActive() || !timeline.back(resetBoard)) return
    setFocusEpoch((epoch) => epoch + 1)
  }
  const restart = () => {
    resetBoard()
    clearTutorialSession(storage, state.playerId, 'additional')
    timeline.restart(createAdditionalTutorialState(state.playerId))
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
    <Card ref={guidance} tabIndex={-1} className={styles.guidance} data-additional-step={state.step}>
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
          <Button variant="outline" data-tutorial-back disabled={!timeline.canGoBack} onClick={back}>{t('tutorial.back')}</Button>
          <Button variant="ghost" ref={exitButton} onClick={() => setExitOpen(true)}>{t('tutorial.exit')}</Button>
        </div>
      </CardContent>
    </Card>
    {!information && <TutorialTenderBoard key={`${boardEpoch}:${state.checkpointKind}`} view={additionalTutorialView(state)}
      documentFlow lessonLabel="tutorial.additional.boardLabel" actionPanelPinned={false} commandError={error ? t(`tutorial.additional.error.${error}`) : null} highlight="none" interpretationRequired={state.step === 'plan'}
      laboratoryInitialMode={laboratoryMode} onLaboratoryModeSelected={(mode) => { if (callbacksActive()) setLaboratoryMode(mode) }}
      onCommand={async (command) => { const rejected = await apply(command); if (rejected) throw new Error(rejected) }}
      onSaveWorkingModel={async (workingModel) => (await apply({ type: 'update-working-model', workingModel })) === undefined}
      onJournalClosed={(workingModel) => void apply({ type: 'update-working-model', workingModel })}
      onExitRequest={() => { if (callbacksActive()) setExitOpen(true) }} onContractsClosed={() => undefined} onContractsOpened={() => undefined}
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
