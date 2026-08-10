import type { PublicContract, ScientificJournalEntry } from '@anomaly-detector/contracts'

import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from '../catalog'
import styles from './PhasePanel.module.css'

type ContractRequirementsProps = {
  contract: PublicContract
  corporateTrust: number
  journal: ScientificJournalEntry[]
  playerId?: string
  round: number
  usedEvidenceTestIds: string[]
}

export function ContractRequirements({
  contract,
  corporateTrust,
  journal,
  playerId,
  round,
  usedEvidenceTestIds,
}: ContractRequirementsProps) {
  const { t } = useI18n()
  const kind = contract.kind ?? 'light'
  const isFinal = kind === 'final'
  const isComplex = kind === 'complex' || isFinal
  const role = contract.targetRole ?? 'source'
  const primaryResult = t(`tender.result.${contract.requiredPublicResult}`)
  const secondaryResult = contract.requiredSecondaryPublicResult
    ? t(`tender.result.${contract.requiredSecondaryPublicResult}`)
    : undefined
  const finalTrust = Math.min(corporateTrust, 2)

  const missingEvidenceMessage = (() => {
    if (!contract.planning?.missingConditions.includes('evidence')) return undefined
    if (!isComplex || !secondaryResult || !playerId || !contract.targetSignal) {
      return t('tender.contractPlanning.missing.evidence')
    }

    const matchingUnusedEvidence = journal.filter((entry) =>
      entry.playerId === playerId
      && !usedEvidenceTestIds.includes(entry.testId)
      && entry[role === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal,
    )
    const hasContinuousPath = matchingUnusedEvidence.some((entry) =>
      entry.protocol === 'continuous'
      && (entry.publicResult === contract.requiredPublicResult
        || entry.publicResult === contract.requiredSecondaryPublicResult),
    )
    const hasPrimaryImpulse = matchingUnusedEvidence.some((entry) =>
      entry.protocol === 'impulse' && entry.publicResult === contract.requiredPublicResult,
    )
    const hasSecondaryImpulse = matchingUnusedEvidence.some((entry) =>
      entry.protocol === 'impulse' && entry.publicResult === contract.requiredSecondaryPublicResult,
    )

    if (!hasContinuousPath && (hasPrimaryImpulse || hasSecondaryImpulse)) {
      return t('tender.contractPlanning.missing.impulseResult', {
        result: hasPrimaryImpulse ? secondaryResult : primaryResult,
      })
    }
    return t('tender.contractPlanning.missing.evidence')
  })()

  const otherMissingMessages = (contract.planning?.missingConditions ?? []).flatMap((condition) => {
    if (condition === 'evidence' || condition === 'final_round' || condition === 'corporate_trust') return []
    const keys = {
      already_resolved: 'tender.contractPlanning.missing.alreadyResolved',
      evidence_result: 'tender.contractPlanning.missing.evidenceResult',
      evidence_role: 'tender.contractPlanning.missing.evidenceRole',
      evidence_used: 'tender.contractPlanning.missing.evidenceUsed',
      reserved: 'tender.contractPlanning.missing.reserved',
    } as const
    return [t(keys[condition])]
  })

  return (
    <>
      {kind === 'scientific' ? (
        <span className={styles.contractFact}>
          <Typography as="span" variant="caption">{t('tender.contractPlanning.condition')}</Typography>
          <Typography as="span" variant="caption">
            {t('tender.contractPlanning.scientificCondition', {
              signal: contract.targetSignal ? t(signalLabelKeys[contract.targetSignal]) : '—',
            })}
          </Typography>
        </span>
      ) : isComplex && secondaryResult ? (
        <>
          <span className={styles.contractFact}>
            <Typography as="span" variant="caption">{t('tender.contractPlanning.continuousPath')}</Typography>
            <Typography as="span" variant="caption">
              {t('tender.contractPlanning.eitherResult', { primary: primaryResult, secondary: secondaryResult })}
            </Typography>
          </span>
          <span className={styles.contractFact}>
            <Typography as="span" variant="caption">{t('tender.contractPlanning.impulsePath')}</Typography>
            <Typography as="span" variant="caption">
              {t('tender.contractPlanning.bothResults', { primary: primaryResult, secondary: secondaryResult })}
            </Typography>
          </span>
        </>
      ) : (
        <span className={styles.contractFact}>
          <Typography as="span" variant="caption">{t('tender.contractPlanning.condition')}</Typography>
          <Typography as="span" variant="caption">{primaryResult}</Typography>
        </span>
      )}

      {isFinal && (
        <>
          <span className={styles.contractFact} data-requirement-state={round === 5 ? 'met' : 'missing'}>
            <Typography as="span" variant="caption">{t('tender.contractPlanning.finalRound')}</Typography>
            <Typography as="span" variant="caption">
              {round === 5
                ? t('tender.contractPlanning.requirementMet')
                : t('tender.contractPlanning.finalRoundProgress', { round })}
            </Typography>
          </span>
          <span className={styles.contractFact} data-requirement-state={corporateTrust >= 2 ? 'met' : 'missing'}>
            <Typography as="span" variant="caption">{t('tender.contractPlanning.completedContracts')}</Typography>
            <Typography as="span" variant="caption">
              {t('tender.contractPlanning.completedContractsProgress', { count: finalTrust })}
            </Typography>
          </span>
        </>
      )}

      {[...(missingEvidenceMessage ? [missingEvidenceMessage] : []), ...otherMissingMessages].map((message) => (
        <Typography key={message} variant="bodySm" className={styles.noSuitableEvidence}>
          {message}
        </Typography>
      ))}
    </>
  )
}
