import type { TenderView } from '@anomaly-detector/contracts'

import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from '../catalog'
import styles from './ContractPlanningPanel.module.css'

export function ContractPlanningPanel({ view }: { view: TenderView }) {
  const { t } = useI18n()
  const contracts = [...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]

  return (
    <details className={styles.panel}>
      <summary>
        <Typography as="strong" variant="bodySmMedium">
          {t('tender.contractPlanning.title', { count: contracts.length })}
        </Typography>
        <Typography as="span" variant="caption" tone="muted">
          {t('tender.contractPlanning.readOnly')}
        </Typography>
      </summary>
      <div className={styles.list}>
        {contracts.map((contract) => {
          const kind = contract.kind ?? 'light'
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
                tone={contract.eligibleForPlayer ? 'default' : 'muted'}
                className={styles.eligibility}
              >
                {contract.eligibleForPlayer
                  ? t('tender.contractPlanning.eligible')
                  : t('tender.contractPlanning.notEligible')}
              </Typography>
            </article>
          )
        })}
      </div>
    </details>
  )
}
