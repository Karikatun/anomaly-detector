import { FlaskConicalIcon, InformationCircleIcon, Logout01Icon } from '@hugeicons/core-free-icons'
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
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n, type TranslationKey } from '@/platform/i18n'
import { PhasePanel } from './TenderPage'
import type { TenderCommandInput } from './commands'
import { TenderPhaseProgress } from './components/TenderPhaseProgress'
import { TenderPhaseLayout } from './components/TenderPhaseLayout'
import { TenderHeaderFrame } from './components/TenderHeaderFrame'
import { TenderPlayers } from './components/TenderOverview'
import { TenderJournalDialog, type TenderJournalTab } from './components/TenderJournalDialog'
import { useWorkingModelDraft } from './use-working-model-draft'
import { ContractPlanningPanel } from './components/ContractPlanningPanel'
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
  actionPanelPinned,
  commandError,
  highlight,
  interpretationRequired,
  laboratoryInitialMode,
  onCommand,
  onContractsClosed,
  onContractsOpened,
  onDirectInterpretationOpened,
  onExitRequest,
  onHelpMenuOpened,
  onInterpretationOpened,
  onLaboratoryModeSelected,
  onJournalClosed,
  onJournalOpenChange,
  onWorkingModelOpened,
  onResearchOpened,
  onRequiredModalOpenChange,
  onSaveWorkingModel,
  view,
}: {
  actionPanelPinned: boolean
  commandError: string | null
  highlight: 'contracts' | 'header' | 'help' | 'interpretation' | 'none' | 'primary' | 'research' | 'sidebar' | 'working-model'
  interpretationRequired: boolean
  laboratoryInitialMode?: 'broad' | 'deep'
  onCommand: (command: TenderCommandInput) => Promise<void>
  onContractsClosed: () => void
  onContractsOpened: () => void
  onDirectInterpretationOpened: () => void
  onExitRequest: () => void
  onHelpMenuOpened: () => void
  onInterpretationOpened: () => void
  onLaboratoryModeSelected: (mode: 'broad' | 'deep') => void
  onJournalClosed: (workingModel: WorkingModel) => void
  onJournalOpenChange: (open: boolean) => void
  onWorkingModelOpened: () => void
  onResearchOpened: () => void
  onRequiredModalOpenChange: (open: boolean) => void
  onSaveWorkingModel: (workingModel: WorkingModel) => Promise<boolean>
  view: TenderView
}) {
  const { t } = useI18n()
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)
  const [journalOpen, setJournalOpen] = useState(false)
  const [journalTab, setJournalTab] = useState<TenderJournalTab>('working-model')
  const [contractsOpen, setContractsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const openHelp = (open: boolean) => {
    setHelpMenuOpen(open)
    if (open) onHelpMenuOpened()
  }

  const openInterpretation = (direct = false) => {
    setHelpMenuOpen(false)
    setRulesOpen(false)
    setContractsOpen(false)
    setJournalTab('interpretation')
    // Let the previous Help focus scope close before Journal captures the opener.
    window.setTimeout(() => { setJournalOpen(true); onJournalOpenChange(true) }, 0)
    if (direct) onDirectInterpretationOpened()
    else onInterpretationOpened()
  }

  const openJournal = (open: boolean) => {
    setJournalOpen(open)
    onJournalOpenChange(open)
    if (open) {
      setRulesOpen(false)
      setContractsOpen(false)
      if (highlight === 'research') {
        setJournalTab('research')
        onResearchOpened()
      } else if (highlight === 'interpretation') {
        setJournalTab('interpretation')
        onInterpretationOpened()
      } else if (highlight === 'working-model') {
        setJournalTab('working-model')
        onWorkingModelOpened()
      }
    } else {
      onJournalClosed(workingModelOwner.model)
    }
  }

  const changeJournalTab = (tab: TenderJournalTab) => {
    setJournalTab(tab)
    if (tab === 'interpretation') onInterpretationOpened()
    if (tab === 'working-model') onWorkingModelOpened()
  }

  const openContracts = (open: boolean) => {
    if (open) { setJournalOpen(false); onJournalOpenChange(false) }
    setContractsOpen(open)
    if (open) onContractsOpened()
    else onContractsClosed()
  }

  const saveWorkingModel = async (workingModel: WorkingModel) => {
    await onSaveWorkingModel(workingModel)
  }

  const workingModelOwner = useWorkingModelDraft(view.privateWorkingModel, saveWorkingModel)

  const myPlayer = view.players[0]
  const activePlayer = view.players.find((player) => player.playerId === view.activePlayerId)
  const isSequentialPhase = sequentialPhases.has(view.phase)
  const isMyTurn = !isSequentialPhase || view.activePlayerId === myPlayer?.playerId
  const isSharedModelAnalysis = view.phase === 'model-analysis'
  const isSharedFinalScientificModel = view.phase === 'final-scientific-model'

  return (
    <section
      className={`${styles.page} ${tutorialStyles.board} mx-auto w-full min-w-0 max-w-[90rem] overflow-x-clip px-3 py-3 sm:px-5 sm:py-5`}
      aria-label={t('tutorial.title')}
      data-tutorial-action-pinned={actionPanelPinned || undefined}
      data-tutorial-board
      data-tutorial-highlight={highlight}
      data-tutorial-phase={view.phase}
      data-tutorial-round={view.round}
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
            {view.phase !== 'complete' && (
              <Badge variant="warning">{t('tender.header.budget', { budget: myPlayer?.budget ?? 0 })}</Badge>
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
          <Badge variant="success" className={styles.connectionBadge}>
            {t('tender.realtime.live')}
          </Badge>
          <Dialog open={helpMenuOpen} onOpenChange={openHelp}>
            <DialogTrigger asChild>
              <Button
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
                <Button
                  data-tutorial-interpretation=""
                  type="button"
                  variant="outline"
                  onClick={() => openInterpretation()}
                >
                  {t('tender.tenderPage.copy.030')}
                </Button>
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
            data-tutorial-interpretation-direct=""
          >
            <Button type="button" variant="outline" size="sm" className={styles.laboratoryAction}
              data-testid="tutorial-interpretation-direct" onClick={() => openInterpretation(true)}>
              <HugeiconsIcon icon={FlaskConicalIcon} strokeWidth={1.7} aria-hidden="true" />
              <Typography as="span" variant="control">{t('rules.laboratory.open')}</Typography>
            </Button>
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
              data-tutorial-primary=""
              data-tutorial-working-model={view.phase === 'model-analysis' ? '' : undefined}
              className="grid min-w-0 self-start gap-4"
            >
              <PhasePanel
                playerId={myPlayer?.playerId}
                view={view}
                disabled={interpretationRequired}
                error={commandError}
                onCommand={onCommand}
                onSaveWorkingModel={saveWorkingModel}
                activePlayerId={view.activePlayerId}
                workingModelDialog={{
                  actionError: journalOpen ? commandError : null,
                  owner: workingModelOwner,
                  onOpenChange: (open) => { setJournalTab('working-model'); openJournal(open) },
                  onSaveStatusChange: () => undefined,
                  open: false,
                  openDisabled: interpretationRequired,
                }}
                training={{
                  laboratoryInitialMode,
                  onRequiredModalOpenChange,
                  onLaboratoryModeSelect: onLaboratoryModeSelected,
                  separateContractReservation: true,
                  untimed: true,
                }}
              />
            </div>
          )}
          sidebar={(
            <div
              className={tutorialStyles.sidebar}
              data-tutorial-sidebar=""
            >
              <TenderPlayers
                activePlayerId={view.activePlayerId}
                currentUserId={view.players[0]?.playerId}
                phase={view.phase}
                players={view.players}
              />
              <div data-tutorial-working-model={view.phase !== 'model-analysis' ? '' : undefined}>
                <TenderJournalDialog
                  actionError={journalOpen ? commandError : null}
                  view={view} owner={workingModelOwner} tab={journalTab} currentPlayerId={myPlayer?.playerId}
                  onTabChange={changeJournalTab} open={journalOpen} onOpenChange={openJournal}
                  disabled={interpretationRequired || view.phase === 'final-scientific-model' || view.phase === 'complete'}
                  showTimerWarning={false} highlightResult="reflection" triggerTestId="tutorial-research-trigger"
                />
              </div>
              <div
                data-tutorial-contracts=""
              >
                <ContractPlanningPanel
                  contentTestId="tutorial-contracts-dialog"
                  open={contractsOpen}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    window.requestAnimationFrame(() => {
                      document.querySelector<HTMLButtonElement>(
                        '[data-tutorial-power-category="reconnaissance"] button:not(:disabled)',
                      )?.focus({ preventScroll: true })
                    })
                  }}
                  onOpenChange={openContracts}
                  playerId={view.players[0]?.playerId}
                  triggerTestId="tutorial-contracts-trigger"
                  view={view}
                />
              </div>
            </div>
          )}
        />
      </div>
    </section>
  )
}
