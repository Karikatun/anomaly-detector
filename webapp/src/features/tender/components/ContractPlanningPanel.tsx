import type { TenderView } from '@anomaly-detector/contracts'
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
import styles from './ContractPlanningPanel.module.css'

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
        return (
          <article key={contract.contractId} className={styles.contract}>
            <span>
              <Typography as="strong" variant="bodySmMedium">
                {t(`tender.contracts.kind.${kind}`)}
              </Typography>
              <Typography as="span" variant="caption" tone="muted">
                {contract.targetSignal
                  ? t(signalLabelKeys[contract.targetSignal])
                  : t('tender.contractPlanning.noTarget')}
              </Typography>
            </span>
            <span className={styles.requirements}>
              <Typography as="span" variant="caption">
                {t('tender.contractPlanning.reward', { count: contract.ratingReward ?? 0 })}
              </Typography>
              <Typography as="span" variant="caption">
                {t('tender.contractPlanning.power', { count: planning?.requiredPower ?? 1 })}
              </Typography>
              <Typography as="span" variant="caption">
                {t(`tender.result.${contract.requiredPublicResult}`)}
              </Typography>
              {contract.requiredSecondaryPublicResult && (
                <Typography as="span" variant="caption">
                  {t(`tender.result.${contract.requiredSecondaryPublicResult}`)}
                </Typography>
              )}
            </span>
            <Typography
              as="span"
              variant="caption"
              tone={planning?.eligible ? 'default' : 'muted'}
              className={styles.eligibility}
            >
              {planning?.eligible
                ? t('tender.contractPlanning.eligible')
                : t('tender.contractPlanning.notEligible')}
            </Typography>
            {planning && (
              <>
                <Typography as="span" variant="caption" tone="muted" className={styles.eligibility}>
                  {planning.suitableEvidenceTestIds.length > 0
                    ? t('tender.contractPlanning.evidence', {
                        count: planning.suitableEvidenceTestIds.length,
                      })
                    : planning.suitableResearchCertificationSignals.length > 0
                      ? t('tender.contractPlanning.certification')
                      : t('tender.contractPlanning.missing')}
                </Typography>
                {planning.missingConditions.length > 0 && (
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
              </>
            )}
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
