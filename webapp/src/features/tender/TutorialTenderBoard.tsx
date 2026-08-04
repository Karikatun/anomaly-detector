import { InformationCircleIcon, Logout01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import type { TenderView, WorkingModel } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { LaboratoryInterpretationDialog, RulesReferenceDialog } from '@/features/rules'
import { useI18n, type TranslationKey } from '@/platform/i18n'
import { PhasePanel } from './TenderPage'
import type { TenderCommandInput } from './commands'
import { TenderPhaseProgress } from './components/TenderPhaseProgress'
import { TenderPhaseLayout } from './components/TenderPhaseLayout'
import { TenderHeaderFrame } from './components/TenderHeaderFrame'
import { TenderPlayers } from './components/TenderOverview'
import { TenderResearchDialog } from './components/TenderResearchDialog'
import { WorkingModelWorkspace } from './components/WorkingModelWorkspace'
import styles from './TenderPage.module.css'
import tutorialStyles from './TutorialTenderBoard.module.css'

const phaseLabelKeys: Record<TenderView['phase'], TranslationKey> = {
  'access-slot-selection': 'tender.tenderPage.copy.001',
  'power-allocation': 'tender.tenderPage.copy.002',
  reconnaissance: 'tender.tenderPage.copy.003',
  laboratory: 'tender.tenderPage.copy.004',
  'model-analysis': 'tender.tenderPage.copy.005',
  contracts: 'tender.tenderPage.copy.006',
  'final-scientific-model': 'tender.tenderPage.copy.007',
  complete: 'tender.tenderPage.copy.008',
}

const sequentialPhases = new Set<TenderView['phase']>(['reconnaissance', 'laboratory', 'contracts'])

export function TutorialTenderBoard({
  commandError,
  highlight,
  interpretationRequired,
  onCommand,
  onDirectInterpretationOpened,
  onExitRequest,
  onHelpMenuOpened,
  onInterpretationClosed,
  onInterpretationOpened,
  onSaveWorkingModel,
  view,
}: {
  commandError: string | null
  highlight: 'help' | 'interpretation' | 'primary' | 'working-model'
  interpretationRequired: boolean
  onCommand: (command: TenderCommandInput) => Promise<void>
  onDirectInterpretationOpened: () => void
  onExitRequest: () => void
  onHelpMenuOpened: () => void
  onInterpretationClosed: () => void
  onInterpretationOpened: () => void
  onSaveWorkingModel: (workingModel: WorkingModel) => Promise<void>
  view: TenderView
}) {
  const { t } = useI18n()
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)
  const [interpretationOpen, setInterpretationOpen] = useState(false)
  const [researchOpen, setResearchOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [workingModelOpen, setWorkingModelOpen] = useState(false)

  const openHelp = (open: boolean) => {
    setHelpMenuOpen(open)
    if (open) onHelpMenuOpened()
  }

  const openInterpretation = (open: boolean) => {
    setInterpretationOpen(open)
    if (open) onInterpretationOpened()
    else {
      setHelpMenuOpen(false)
      onInterpretationClosed()
    }
  }

  const openDirectInterpretation = (open: boolean) => {
    setInterpretationOpen(open)
    if (open) onDirectInterpretationOpened()
    else onInterpretationClosed()
  }

  const myPlayer = view.players[0]
  const activePlayer = view.players.find((player) => player.playerId === view.activePlayerId)
  const isSequentialPhase = sequentialPhases.has(view.phase)
  const isMyTurn = !isSequentialPhase || view.activePlayerId === myPlayer?.playerId
  const isSharedModelAnalysis = view.phase === 'model-analysis'
  const isSharedFinalScientificModel = view.phase === 'final-scientific-model'

  return (
    <section
      className={`${styles.page} mx-auto w-full min-w-0 max-w-[90rem] overflow-x-clip px-3 py-3 sm:px-5 sm:py-5`}
      aria-label={t('tutorial.title')}
    >
      <TenderHeaderFrame
        ariaLabel={t('tender.phase.status')}
        info={(
          <>
            <Typography variant="shortcut" tone="muted" className="uppercase">
              {t('tender.header.round', { round: view.round })}
            </Typography>
            <Typography as="h3" variant="bodySmMedium" className="truncate">
              {t(phaseLabelKeys[view.phase])}
            </Typography>
          </>
        )}
        timer={<Badge variant="outline">{t('tutorial.noTimer')}</Badge>}
        meta={(
          <>
            {myPlayer?.accessSlot && (
              <Badge variant="outline">{t('tender.header.slot', { slot: myPlayer.accessSlot })}</Badge>
            )}
            {view.phase === 'access-slot-selection' && (
              <Badge variant="outline">{t('tender.header.budget', { budget: myPlayer?.budget ?? 0 })}</Badge>
            )}
            {isSequentialPhase && (
              <Badge variant={isMyTurn ? 'default' : 'outline'}>
                {isMyTurn
                  ? t('tender.tenderPage.copy.023')
                  : t('tender.tenderPage.copy.024', { value1: activePlayer?.displayName ?? t('tender.player.fallbackGenitive') })}
              </Badge>
            )}
            {isSharedModelAnalysis && view.modelAnalysisProgress && (
              <Badge variant="outline">
                {t('tender.phase.completed', {
                  completed: view.modelAnalysisProgress.completed,
                  total: view.modelAnalysisProgress.total,
                })}
              </Badge>
            )}
            {isSharedFinalScientificModel && view.finalScientificModelProgress && (
              <Badge variant="outline">
                {t('tender.phase.completed', {
                  completed: view.finalScientificModelProgress.completed,
                  total: view.finalScientificModelProgress.total,
                })}
              </Badge>
            )}
          </>
        )}
        actions={(
          <>
          <Badge variant="outline" className={`${styles.connectionBadge} text-emerald-400`}>
            {t('tender.realtime.live')}
          </Badge>
          <Dialog open={helpMenuOpen} onOpenChange={openHelp}>
            <DialogTrigger asChild>
              <Button
                data-tutorial-active={highlight === 'help' || undefined}
                data-tutorial-help=""
                type="button"
                variant="outline"
                size="sm"
                className={styles.helpAction}
              >
                <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
                <Typography as="span" variant="control">{t('tender.tenderPage.copy.025')}</Typography>
              </Button>
            </DialogTrigger>
            <DialogContent closeLabel={t('tender.tenderPage.copy.026')}>
              <DialogHeader>
                <DialogTitle>{t('tender.tenderPage.copy.027')}</DialogTitle>
                <DialogDescription>{t('tender.tenderPage.copy.028')}</DialogDescription>
              </DialogHeader>
              <div className={styles.helpMenu}>
                <Button type="button" variant="outline" onClick={() => {
                  setHelpMenuOpen(false)
                  setRulesOpen(true)
                }}>
                  {t('tender.tenderPage.copy.029')}
                </Button>
                <div
                  data-tutorial-active={highlight === 'interpretation' || undefined}
                  data-tutorial-interpretation=""
                >
                  <Button type="button" variant="outline" onClick={() => openInterpretation(true)}>
                    {t('tender.tenderPage.copy.030')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <RulesReferenceDialog
            belowTenderHeader
            open={rulesOpen}
            onOpenChange={setRulesOpen}
            ruleset="tender-v2"
            triggerClassName={styles.rulesAction}
            triggerIcon="book"
          />
          <div
            className={tutorialStyles.directInterpretation}
            data-tutorial-active={highlight === 'interpretation' || undefined}
            data-tutorial-interpretation-direct=""
          >
            <LaboratoryInterpretationDialog
              belowTenderHeader
              open={interpretationOpen}
              onOpenChange={openDirectInterpretation}
              ruleset="tender-v2"
              triggerClassName={styles.laboratoryAction}
              triggerTestId="tutorial-interpretation-direct"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={styles.leaveAction}
            aria-label={t('tutorial.exit')}
            title={t('tutorial.exit')}
            onClick={onExitRequest}
          >
            <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="control">{t('button.logout')}</Typography>
          </Button>
          </>
        )}
      />

      <div className={styles.content}>
        <TenderPhaseLayout
          progress={<TenderPhaseProgress phase={view.phase} />}
          primary={(
            <div
              data-tutorial-active={(highlight === 'primary' || (highlight === 'working-model' && view.phase === 'model-analysis')) || undefined}
              data-tutorial-primary=""
              data-tutorial-working-model={view.phase === 'model-analysis' ? '' : undefined}
              className="grid min-w-0 self-start gap-4"
            >
              <PhasePanel
                view={view}
                disabled={interpretationRequired}
                error={commandError}
                onCommand={onCommand}
                onSaveWorkingModel={onSaveWorkingModel}
                activePlayerId={view.activePlayerId}
                workingModelDialog={{
                  onOpenChange: setWorkingModelOpen,
                  onSaveStatusChange: () => undefined,
                  open: workingModelOpen,
                  openDisabled: interpretationRequired,
                }}
                training={{
                  separateContractReservation: true,
                  unlimitedThesisRetries: true,
                  untimed: true,
                }}
              />
            </div>
          )}
          sidebar={(
            <>
              <TenderPlayers
                activePlayerId={view.activePlayerId}
                currentUserId={view.players[0]?.playerId}
                phase={view.phase}
                players={view.players}
              />
              <TenderResearchDialog open={researchOpen} onOpenChange={setResearchOpen} view={view} />
              {view.phase !== 'model-analysis' && (
                <div
                  data-tutorial-active={highlight === 'working-model' || undefined}
                  data-tutorial-working-model=""
                >
                  <WorkingModelWorkspace
                    inlineOnDesktop
                    knownSignals={view.privateSamples}
                    model={view.privateWorkingModel}
                    onOpenChange={setWorkingModelOpen}
                    onSave={onSaveWorkingModel}
                    open={workingModelOpen}
                    openDisabled={interpretationRequired}
                  />
                </div>
              )}
            </>
          )}
        />
      </div>
    </section>
  )
}
