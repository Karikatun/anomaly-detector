import type { TenderView } from '@anomaly-detector/contracts'
import type { CSSProperties } from 'react'
import { useState } from 'react'

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
import { SignalGlyph } from './SignalGlyph'
import { contractKindAccents, signalAccent } from './signal-visuals'
import styles from './ContractPlanningPanel.module.css'
import phaseStyles from './PhasePanel.module.css'

const missingConditionKeys = {
  already_resolved: 'tender.contractPlanning.missing.alreadyResolved',
  corporate_trust: 'tender.contractPlanning.missing.corporateTrust',
  evidence: 'tender.contractPlanning.missing.evidence',
  final_round: 'tender.contractPlanning.missing.finalRound',
  reserved: 'tender.contractPlanning.missing.reserved',
} as const

export function ContractPlanningPanel({
  closeSheet = false,
  view,
}: {
  closeSheet?: boolean
  view: TenderView
}) {
  const { t } = useI18n()
  const [sheetState, setSheetState] = useState({ closeSheet, open: false })
  const sheetOpen = sheetState.closeSheet === closeSheet && sheetState.open
  const contracts = [...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]
  const nearestContract = contracts.find((contract) => contract.planning?.eligible) ?? contracts[0]

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
        const planningDetail = planning?.suitableEvidenceTestIds.length
          ? t('tender.contractPlanning.evidence', {
              count: planning.suitableEvidenceTestIds.length,
            })
          : planning?.suitableResearchCertificationSignals.length
            ? t('tender.contractPlanning.certification')
            : t('tender.contractPlanning.missing')
        return (
          <article
            key={contract.contractId}
            className={`${phaseStyles.contractCard} ${kind === 'final' ? phaseStyles.finalContract : ''}`}
            style={contractStyle}
          >
            <header className={`${phaseStyles.contractHeader} ${styles.contractHeader}`}>
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
              <span className={`${phaseStyles.contractReward} ${styles.contractReward}`}>
                <Typography as="strong" variant="bodySmMedium">
                  +{contract.ratingReward ?? 0}
                </Typography>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.rating')}
                </Typography>
              </span>
            </header>

            <div className={phaseStyles.contractFacts}>
              <span className={phaseStyles.contractFact}>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.result')}
                </Typography>
                <Typography as="span" variant="caption">
                  {t(`tender.result.${contract.requiredPublicResult}`)}
                </Typography>
              </span>
              {contract.requiredSecondaryPublicResult && (
                <span className={phaseStyles.contractFact}>
                  <Typography as="span" variant="caption">
                    {t('tender.contractPlanning.additionalResult')}
                  </Typography>
                  <Typography as="span" variant="caption">
                    {t(`tender.result.${contract.requiredSecondaryPublicResult}`)}
                  </Typography>
                </span>
              )}
              <span className={phaseStyles.contractFact}>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.powerLabel')}
                </Typography>
                <Typography as="span" variant="caption">
                  {planning?.requiredPower ?? 1}
                </Typography>
              </span>
              <span className={phaseStyles.contractFact}>
                <Typography as="span" variant="caption">
                  {t('tender.contractPlanning.status')}
                </Typography>
                <Typography as="span" variant="caption">
                  {planning?.eligible
                    ? t('tender.contractPlanning.ready')
                    : t('tender.contractPlanning.needsPreparation')}
                </Typography>
              </span>
            </div>

            <div className={styles.planningState} data-eligible={planning?.eligible || undefined}>
              <Typography as="strong" variant="bodySmMedium">
                {planning?.eligible
                  ? t('tender.contractPlanning.eligible')
                  : t('tender.contractPlanning.notEligible')}
              </Typography>
              <Typography variant="caption" tone="muted">
                {planningDetail}
              </Typography>
              {planning && planning.missingConditions.length > 0 && (
                <ul className={styles.missingConditions}>
                  {planning.missingConditions.map((condition) => (
                    <li key={condition}>
                      <Typography variant="caption" tone="muted">
                        {t(missingConditionKeys[condition])}
                      </Typography>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )

  return (
    <>
      <section className={`${styles.panel} ${styles.desktopPanel}`}>
        <header className={styles.summary}>
          <Typography as="strong" variant="bodySmMedium">
            {t('tender.contractPlanning.title', { count: contracts.length })}
          </Typography>
          <Typography as="span" variant="caption" tone="muted">
            {t('tender.contractPlanning.readOnly')}
          </Typography>
        </header>
        {renderList()}
      </section>
      <Dialog
        open={sheetOpen && !closeSheet}
        onOpenChange={(open) => setSheetState({ closeSheet, open })}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className={styles.mobileTrigger}>
            {t('tender.contractPlanning.title', { count: contracts.length })}
          </Button>
        </DialogTrigger>
        {nearestContract && (
          <Typography variant="caption" tone="muted" className={styles.nearest}>
            {t('tender.contractPlanning.nearest', {
              contract: t(`tender.contracts.kind.${nearestContract.kind ?? 'light'}`),
            })}
          </Typography>
        )}
        <DialogContent
          placement="viewport"
          className={styles.sheet}
          closeLabel={t('rules.close')}
        >
          <DialogHeader>
            <DialogTitle>{t('tender.contractPlanning.title', { count: contracts.length })}</DialogTitle>
            <DialogDescription>{t('tender.contractPlanning.readOnly')}</DialogDescription>
          </DialogHeader>
          {renderList()}
        </DialogContent>
      </Dialog>
    </>
  )
}
