import { translate } from '../../platform/i18n'
import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  SignalFullIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type {
  PublicContract,
  ScientificJournalEntry,
  SignalId,
  TenderView,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from './catalog'
import styles from './components/PhasePanel.module.css'
import { ContractRequirements } from './components/ContractRequirements'
import { SignalGlyph } from './components/SignalGlyph'
import { contractKindAccents, signalAccent } from './components/signal-visuals'

type ContractBid = { evidenceTestIds: string[]; researchCertificationSignal?: SignalId }

type ContractsPanelProps = {
  certifications: SignalId[]
  contracts: PublicContract[]
  journal: ScientificJournalEntry[]
  maxPower: number
  playerId: string
  players: TenderView['players']
  privateUsedContractEvidenceTestIds: string[]
  round: number
  disabled?: boolean
  error?: string | null
  separateReservation?: boolean
  onReserve: (contractId: string) => Promise<void>
  onSkip: () => Promise<void>
  onBid: (contractId: string, bid: ContractBid) => Promise<void>
}

export function ContractsPanel({
  certifications,
  contracts,
  journal,
  maxPower,
  playerId,
  players,
  privateUsedContractEvidenceTestIds,
  round,
  disabled,
  error,
  separateReservation = false,
  onReserve,
  onSkip,
  onBid,
}: ContractsPanelProps) {
  const [bids, setBids] = useState<Record<string, ContractBid>>({})
  const { t } = useI18n()
  const ownJournal = journal.filter((entry) =>
    entry.playerId === playerId && !privateUsedContractEvidenceTestIds.includes(entry.testId),
  )
  const reservedContract = contracts.find((contract) => contract.reservedByPlayerId === playerId)
  const eligibleContracts = contracts.filter((contract) =>
    contract.planning?.eligible ?? contract.eligibleForPlayer,
  )
  const hasSubmittedContract = contracts.some((contract) =>
    contract.reservedByPlayerId === playerId && contract.bidOutcome !== undefined,
  )
  const corporateTrust = players.find((player) => player.playerId === playerId)?.corporateTrust ?? 0

  const handleConfirmContract = async (contractId: string, bid: ContractBid, alreadyReserved: boolean) => {
    try {
      if (!alreadyReserved) {
        await onReserve(contractId)
        if (separateReservation) return
      }
      await onBid(contractId, bid)
      setBids((previous) => {
        const next = { ...previous }
        delete next[contractId]
        return next
      })
    } catch {
      // The parent owns the visible command error; keep the complete bid for retry.
    }
  }

  const evidenceLabel = (entry: ScientificJournalEntry) =>
    translate('tender.contractsPanel.copy.001', { value1: t(signalLabelKeys[entry.sourceSignal]), value2: t(signalLabelKeys[entry.receiverSignal]), value3: t(`tender.result.${entry.publicResult}`), value4: t(entry.protocol === 'continuous' ? 'tender.protocol.continuous' : 'tender.protocol.impulse') })

  return (
    <section className={styles.contractsWorkspace} aria-labelledby="contracts-heading">
      <div className={styles.contractsMain}>
        <div className={`${styles.surface} ${styles.intro}`}>
          <div className={styles.sectionHeader}>
            <Typography id="contracts-heading" as="h2" variant="h4" className={styles.title}>
              
              {translate('tender.contractsPanel.copy.002')}
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{maxPower}  {translate('tender.contractsPanel.copy.003')}</Typography>
          </div>
          <Typography variant="bodySm" className={styles.description}>
            
            {translate('tender.contractsPanel.copy.004')}
          </Typography>
        </div>

        <div className={styles.surface}>
          {contracts.length === 0 && <Typography tone="muted">{t('tender.contracts.empty')}</Typography>}
          {!reservedContract && eligibleContracts.length === 0 && contracts.length > 0 && (
            <div className={styles.contractSelection}>
              <Button type="button" variant="outline" disabled={disabled} onClick={() => void onSkip()}>
                
                {translate('tender.contractsPanel.copy.005')}
              </Button>
            </div>
          )}
          <div className={styles.contractGrid}>
            {contracts.map((contract) => {
              const kind = contract.kind ?? 'light'
              const bid = bids[contract.contractId] ?? { evidenceTestIds: [] }
              const isFinal = kind === 'final'
              const canResolve = !isFinal || round === 5
              const reservedByOther = Boolean(contract.reservedByPlayerId && contract.reservedByPlayerId !== playerId)
              const reservedBySelf = contract.reservedByPlayerId === playerId
              const reservedByName = players.find((candidate) => candidate.playerId === contract.reservedByPlayerId)?.displayName
              const target = contract.targetSignal
              const contractLabel = target
                ? `${t(signalLabelKeys[target])} · ${t(`tender.contracts.role.${contract.targetRole ?? 'source'}`)}`
                : t(`tender.contracts.kind.${kind}`)
              const planning = contract.planning
              const suitableEvidenceSelections = planning?.suitableEvidenceSelections
                ?? ownJournal
                  .filter((entry) =>
                    entry[contract.targetRole === 'receiver' ? 'receiverSignal' : 'sourceSignal'] === target
                    && entry.publicResult === contract.requiredPublicResult,
                  )
                  .map((entry) => [entry.testId])
              const evidenceById = new Map(ownJournal.map((entry) => [entry.testId, entry]))
              const selectablePrimaryEvidence = [...new Set(
                suitableEvidenceSelections.map((selection) => selection[0]),
              )].flatMap((testId) => evidenceById.get(testId) ?? [])
              const selectedEvidenceSelections = suitableEvidenceSelections.filter((selection) =>
                selection[0] === bid.evidenceTestIds[0],
              )
              const requiresSecondaryEvidence = selectedEvidenceSelections.some((selection) => selection.length === 2)
              const selectableSecondaryEvidence = [...new Set(
                selectedEvidenceSelections.flatMap((selection) => selection.slice(1)),
              )].flatMap((testId) => evidenceById.get(testId) ?? [])
              const suitableCertificationSignals = new Set(
                planning?.suitableResearchCertificationSignals ?? [],
              )
              const fittingCertifications = certifications.filter((signal) =>
                signal === target
                && (planning === undefined || suitableCertificationSignals.has(signal)),
              )
              const hasSuitableResearch = planning
                ? planning.eligible
                : kind === 'scientific'
                  ? fittingCertifications.length > 0
                  : kind === 'light'
                    ? selectablePrimaryEvidence.length > 0
                    : suitableEvidenceSelections.length > 0
              const bidIsComplete = kind === 'scientific'
                ? Boolean(bid.researchCertificationSignal)
                : suitableEvidenceSelections.some((selection) =>
                    selection.length === bid.evidenceTestIds.length
                    && selection.every((testId) => bid.evidenceTestIds.includes(testId)),
                  )
              const canChooseResearch = Boolean(
                ((planning?.eligible ?? contract.eligibleForPlayer) || reservedBySelf)
                && !reservedByOther
                && !hasSubmittedContract
                && contract.bidOutcome === undefined,
              )
              const contractStyle = {
                '--contract-accent': contractKindAccents[kind],
                ...(target ? { '--signal-accent': signalAccent(target) } : {}),
              } as CSSProperties
              const contractStatusState = contract.bidOutcome === 'awarded'
                ? 'accepted'
                : contract.bidOutcome === 'failed'
                  ? 'error'
                  : reservedByOther || reservedBySelf
                    ? 'locked'
                    : (planning?.eligible ?? contract.eligibleForPlayer)
                      ? 'ready'
                      : 'waiting'

              return (
                <article
                  key={contract.contractId}
                  className={`${styles.contractCard} ${isFinal ? styles.finalContract : ''}`}
                  data-active={(reservedBySelf || bids[contract.contractId] !== undefined) || undefined}
                  data-contract-id={contract.contractId}
                  data-contract-kind={kind}
                  style={contractStyle}
                >
                  <header className={styles.contractHeader}>
                    <SignalGlyph signal={target} className={styles.signalGlyph} />
                    <span className={styles.signalCopy}>
                      <Typography as="span" variant="caption" className={styles.contractKind}>
                        {t(`tender.contracts.kind.${kind}`)}
                      </Typography>
                      <Typography as="strong" variant="bodySmMedium" className={styles.signalName}>
                        {target
                          ? `${t(signalLabelKeys[target])} · ${t(`tender.contracts.role.${contract.targetRole ?? 'source'}`)}`
                          : contract.contractId}
                      </Typography>
                    </span>
                    <span className={styles.contractReward}>
                      <Typography as="strong" variant="bodySmMedium">+{contract.ratingReward ?? 2}</Typography>
                      <Typography as="span" variant="caption">{translate('tender.contractsPanel.copy.006')}</Typography>
                    </span>
                  </header>

                  <div className={styles.contractFacts}>
                    <ContractRequirements
                      contract={contract}
                      corporateTrust={corporateTrust}
                      journal={journal}
                      playerId={playerId}
                      round={round}
                      usedEvidenceTestIds={privateUsedContractEvidenceTestIds}
                    />
                    <span className={styles.contractFact}>
                      <Typography as="span" variant="caption">{translate('tender.contractsPanel.copy.009')}</Typography>
                      <Typography
                        as="span"
                        variant="caption"
                        className={styles.contractStatus}
                        data-state={contractStatusState}
                      >
                        {contract.bidOutcome === 'awarded'
                          ? translate('tender.contractsPanel.copy.010')
                          : contract.bidOutcome === 'failed'
                            ? translate('tender.contractsPanel.copy.011')
                            : reservedByOther
                            ? translate('tender.contractsPanel.copy.012', { value1: reservedByName ?? t('tender.player.fallback') })
                            : reservedBySelf
                              ? translate('tender.contractsPanel.copy.013')
                              : (planning?.eligible ?? contract.eligibleForPlayer)
                                ? t('tender.contractPlanning.ready')
                                : t('tender.contractPlanning.needsPreparation')}
                      </Typography>
                    </span>
                  </div>

                  {canChooseResearch && hasSuitableResearch && (
                    <div className={styles.contractResearch}>
                      {kind === 'scientific' ? (
                        <>
                          <Typography variant="caption" tone="muted">
                            
                            {translate('tender.contractsPanel.copy.016')}
                          </Typography>
                          <NativeSelect
                            aria-label={translate('tender.contractsPanel.copy.017', { value1: contractLabel })}
                            value={bid.researchCertificationSignal ?? ''}
                            onChange={(event) => setBids((previous) => ({
                              ...previous,
                              [contract.contractId]: {
                                ...bid,
                                researchCertificationSignal: event.target.value
                                  ? event.target.value as SignalId
                                  : undefined,
                              },
                            }))}
                          >
                            <option value="">{translate('tender.contractsPanel.copy.018')}</option>
                            {fittingCertifications.map((signal) => (
                              <option key={signal} value={signal}>{t(signalLabelKeys[signal])}</option>
                            ))}
                          </NativeSelect>
                        </>
                      ) : (
                        <>
                          <Typography variant="caption" tone="muted">
                            
                            {translate('tender.contractsPanel.copy.019')}
                          </Typography>
                          <NativeSelect
                            aria-label={translate('tender.contractsPanel.copy.020', { value1: contractLabel })}
                            value={bid.evidenceTestIds[0] ?? ''}
                            onChange={(event) => {
                              const testId = event.target.value
                              setBids((previous) => ({
                                ...previous,
                                [contract.contractId]: {
                                  ...bid,
                                  evidenceTestIds: testId
                                    ? [
                                      testId,
                                      ...(suitableEvidenceSelections.some((selection) =>
                                        selection[0] === testId && selection.length === 2,
                                      ) && bid.evidenceTestIds[1]
                                        ? [bid.evidenceTestIds[1]]
                                        : []),
                                    ]
                                    : [],
                                },
                              }))
                            }}
                          >
                            <option value="">{translate('tender.contractsPanel.copy.021')}</option>
                            {selectablePrimaryEvidence.map((entry) => (
                              <option key={entry.testId} value={entry.testId}>{evidenceLabel(entry)}</option>
                            ))}
                          </NativeSelect>

                          {(kind === 'complex' || kind === 'final') && (
                            <>
                              <Typography variant="caption" tone="muted">
                                
                                {translate('tender.contractsPanel.copy.022')}
                              </Typography>
                              <NativeSelect
                                aria-label={translate('tender.contractsPanel.copy.023', { value1: contractLabel })}
                                value={bid.evidenceTestIds[1] ?? ''}
                                disabled={!requiresSecondaryEvidence}
                                onChange={(event) => {
                                  const testId = event.target.value
                                  const primaryId = bid.evidenceTestIds[0]
                                  setBids((previous) => ({
                                    ...previous,
                                    [contract.contractId]: {
                                      ...bid,
                                      evidenceTestIds: primaryId
                                        ? [primaryId, ...(testId ? [testId] : [])]
                                        : [],
                                    },
                                  }))
                                }}
                              >
                                <option value="">{translate('tender.contractsPanel.copy.024')}</option>
                                {selectableSecondaryEvidence.map((entry) => (
                                  <option key={entry.testId} value={entry.testId}>{evidenceLabel(entry)}</option>
                                ))}
                              </NativeSelect>
                            </>
                          )}
                        </>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        aria-label={separateReservation && !reservedBySelf
                          ? t('tender.contracts.reserveAria', { id: contractLabel })
                          : translate('tender.contractsPanel.copy.025', { value1: contractLabel })}
                        disabled={disabled || !bidIsComplete}
                        onClick={() => void handleConfirmContract(contract.contractId, bid, reservedBySelf)}
                      >
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.7} aria-hidden="true" />
                        
                        {separateReservation && !reservedBySelf
                          ? t('tender.contracts.reserve')
                          : translate('tender.contractsPanel.copy.026')}
                      </Button>
                    </div>
                  )}

                  {!hasSuitableResearch
                    && !reservedByOther
                    && contract.bidOutcome === undefined
                    && planning === undefined
                    && (!isFinal || canResolve) && (
                    <Typography variant="bodySm" className={styles.noSuitableEvidence}>
                      
                      {translate('tender.contractsPanel.copy.027')}
                    </Typography>
                  )}

                  {contract.bidOutcome !== undefined && (
                    <Typography variant="caption" className={styles.reservedHint}>
                      {contract.bidOutcome === 'awarded' ? translate('tender.contractsPanel.copy.028') : translate('tender.contractsPanel.copy.029')}
                    </Typography>
                  )}
                </article>
              )
            })}
          </div>
        </div>

        {error && <div className={styles.error} role="alert"><Typography variant="bodySm">{error}</Typography></div>}
        <div className={styles.warning}>
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">{translate('tender.contractsPanel.copy.030')}</Typography>
        </div>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">{translate('tender.contractsPanel.copy.031')}</Typography>
          <HugeiconsIcon icon={SignalFullIcon} strokeWidth={1.7} aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}
