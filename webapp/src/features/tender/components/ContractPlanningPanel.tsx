import type { TenderView } from '@anomaly-detector/contracts'
import type { CSSProperties } from 'react'

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
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from '../catalog'
import { ContractRequirements } from './ContractRequirements'
import { SignalGlyph } from './SignalGlyph'
import { contractKindAccents, signalAccent } from './signal-visuals'
import styles from './ContractPlanningPanel.module.css'
import dialogStyles from './TenderContextDialog.module.css'
import phaseStyles from './PhasePanel.module.css'

export function ContractPlanningPanel({
  contentTestId,
  onOpenChange,
  open,
  playerId,
  triggerTestId,
  view,
}: {
  contentTestId?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  playerId?: string
  triggerTestId?: string
  view: TenderView
}) {
  const { t } = useI18n()
  const contracts = [...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]
  const corporateTrust = view.players.find((player) => player.playerId === playerId)?.corporateTrust ?? 0

  const renderList = () => (
    <div className={styles.list}>
      {contracts.map((contract) => {
        const kind = contract.kind ?? 'light'
        const planning = contract.planning
        const target = contract.targetSignal
        const contractStyle = {
          '--contract-accent': contractKindAccents[kind],
          ...(target ? { '--signal-accent': signalAccent(target) } : {}),
        } as CSSProperties
        return (
          <article
            key={contract.contractId}
            className={`${phaseStyles.contractCard} ${kind === 'final' ? phaseStyles.finalContract : ''}`}
            style={contractStyle}
          >
            <header className={phaseStyles.contractHeader}>
              <SignalGlyph signal={target} className={phaseStyles.signalGlyph} />
              <span className={phaseStyles.signalCopy}>
                <Typography as="span" variant="caption" className={phaseStyles.contractKind}>
                  {t(`tender.contracts.kind.${kind}`)}
                </Typography>
                <Typography as="strong" variant="bodySmMedium" className={phaseStyles.signalName}>
                  {target
                    ? `${t(signalLabelKeys[target])} · ${t(`tender.contracts.role.${contract.targetRole ?? 'source'}`)}`
                    : t('tender.contractPlanning.noTarget')}
                </Typography>
              </span>
              <span className={phaseStyles.contractReward}>
                <Typography as="strong" variant="bodySmMedium">
                  +{contract.ratingReward ?? 0}
                </Typography>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.rating')}
                </Typography>
              </span>
            </header>

            <div className={phaseStyles.contractFacts}>
              <ContractRequirements
                contract={contract}
                corporateTrust={corporateTrust}
                journal={view.publicScientificJournal ?? []}
                playerId={playerId}
                round={view.round}
                usedEvidenceTestIds={view.privateUsedContractEvidenceTestIds ?? []}
              />
              <span className={phaseStyles.contractFact}>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.status')}
                </Typography>
                <Typography
                  as="span"
                  variant="caption"
                  className={phaseStyles.contractStatus}
                  data-state={planning?.eligible ? 'ready' : 'waiting'}
                >
                  {planning?.eligible
                    ? t('tender.contractPlanning.ready')
                    : t('tender.contractPlanning.needsPreparation')}
                </Typography>
              </span>
            </div>

            {!planning?.eligible && planning === undefined && (
              <Typography variant="bodySm" className={phaseStyles.noSuitableEvidence}>
                {t('tender.contractPlanning.notEligible')}
              </Typography>
            )}
          </article>
        )
      })}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button data-testid={triggerTestId} type="button" variant="outline" className={dialogStyles.trigger}>
            {t('tender.contractPlanning.title', { count: contracts.length })}
          </Button>
        </DialogTrigger>
        <DialogContent
          placement="viewport"
          className={dialogStyles.dialog}
          closeLabel={t('tender.contractPlanning.close')}
          data-testid={contentTestId}
        >
          <DialogHeader className={dialogStyles.header}>
            <DialogTitle>{t('tender.contractPlanning.title', { count: contracts.length })}</DialogTitle>
            <DialogDescription>{t('tender.contractPlanning.readOnly')}</DialogDescription>
          </DialogHeader>
          <div className={dialogStyles.content}>{renderList()}</div>
        </DialogContent>
    </Dialog>
  )
}
