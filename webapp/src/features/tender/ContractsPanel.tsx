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
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'

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
  onReserve: (contractId: string) => Promise<void>
  onSkip: () => Promise<void>
  onBid: (contractId: string, bid: ContractBid) => Promise<void>
}

const kindAccents = {
  light: '#38bdf8',
  complex: '#f29a38',
  scientific: '#bd72f4',
  final: '#f3bd42',
} as const

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
  const eligibleContracts = contracts.filter((contract) => contract.eligibleForPlayer)
  const hasSubmittedContract = contracts.some((contract) =>
    contract.reservedByPlayerId === playerId && contract.bidOutcome !== undefined,
  )

  const handleConfirmContract = async (contractId: string, bid: ContractBid, alreadyReserved: boolean) => {
    try {
      if (!alreadyReserved) {
        await onReserve(contractId)
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
    `${t(signalLabelKeys[entry.sourceSignal])} → ${t(signalLabelKeys[entry.receiverSignal])} · ${t(`tender.result.${entry.publicResult}`)} · ${entry.protocol === 'continuous' ? 'непрерывный' : 'импульсный'}`

  return (
    <section className={styles.contractsWorkspace} aria-labelledby="contracts-heading">
      <div className={styles.contractsMain}>
        <div className={`${styles.surface} ${styles.intro}`}>
          <div className={styles.sectionHeader}>
            <Typography id="contracts-heading" as="h2" variant="h4" className={styles.title}>
              Доступные контракты
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{maxPower} мощности</Typography>
          </div>
          <Typography variant="bodySm" className={styles.description}>
            Выберите контракт и заранее проверьте подходящие исследования.
          </Typography>
        </div>

        <div className={styles.surface}>
          {contracts.length === 0 && <Typography tone="muted">{t('tender.contracts.empty')}</Typography>}
          {!reservedContract && eligibleContracts.length === 0 && contracts.length > 0 && (
            <div className={styles.contractSelection}>
              <Button type="button" variant="outline" disabled={disabled} onClick={() => void onSkip()}>
                Пропустить ход
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
              const targetRole = contract.targetRole ?? 'source'
              const targetKey = targetRole === 'source' ? 'sourceSignal' : 'receiverSignal'
              const targetEvidence = ownJournal.filter((entry) => entry[targetKey] === target)
              const primaryEvidence = targetEvidence.filter((entry) => entry.publicResult === contract.requiredPublicResult)
              const secondaryResult = contract.requiredSecondaryPublicResult
                ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
              const secondaryEvidence = targetEvidence.filter((entry) => entry.publicResult === secondaryResult)
              const selectablePrimaryEvidence = (kind === 'complex' || kind === 'final')
                && secondaryEvidence.length === 0
                ? primaryEvidence.filter((entry) => entry.protocol === 'continuous')
                : primaryEvidence
              const selectedPrimaryEvidence = primaryEvidence.find((entry) => entry.testId === bid.evidenceTestIds[0])
              const requiresSecondaryEvidence = (kind === 'complex' || kind === 'final')
                && Boolean(selectedPrimaryEvidence && selectedPrimaryEvidence.protocol !== 'continuous')
              const fittingCertifications = certifications.filter((signal) => signal === target)
              const hasSuitableResearch = kind === 'scientific'
                ? fittingCertifications.length > 0
                : kind === 'light'
                  ? primaryEvidence.length > 0
                  : primaryEvidence.some((entry) => entry.protocol === 'continuous')
                    || (primaryEvidence.length > 0 && secondaryEvidence.length > 0)
              const bidIsComplete = kind === 'scientific'
                ? Boolean(bid.researchCertificationSignal)
                : bid.evidenceTestIds.length > 0
                  && (!requiresSecondaryEvidence || bid.evidenceTestIds.length === 2)
              const canChooseResearch = Boolean(
                (contract.eligibleForPlayer || reservedBySelf)
                && !reservedByOther
                && !hasSubmittedContract
                && contract.bidOutcome === undefined,
              )
              const contractStyle = {
                '--contract-accent': kindAccents[kind],
                ...(target ? { '--signal-accent': signalAccent(target) } : {}),
              } as CSSProperties

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
                      <Typography as="span" variant="caption">рейтинга</Typography>
                    </span>
                  </header>

                  <div className={styles.contractFacts}>
                    <span className={styles.contractFact}>
                      <Typography as="span" variant="caption">Результат</Typography>
                      <Typography as="span" variant="caption">{t(`tender.result.${contract.requiredPublicResult}`)}</Typography>
                    </span>
                    {contract.requiredSecondaryPublicResult && (kind === 'complex' || isFinal) && (
                      <span className={styles.contractFact}>
                        <Typography as="span" variant="caption">Альтернатива</Typography>
                        <Typography as="span" variant="caption">{t(`tender.result.${contract.requiredSecondaryPublicResult}`)}</Typography>
                      </span>
                    )}
                    <span className={styles.contractFact}>
                      <Typography as="span" variant="caption">Статус</Typography>
                      <Typography as="span" variant="caption">
                        {contract.bidOutcome === 'awarded'
                          ? 'Выполнен'
                          : contract.bidOutcome === 'failed'
                            ? 'Заявка отклонена'
                            : reservedByOther
                            ? `Зарезервирован · ${reservedByName ?? 'игрок'}`
                            : reservedBySelf
                              ? 'Зарезервирован · вами'
                              : isFinal && !canResolve ? 'Доступен в раунде 5' : 'Свободен'}
                      </Typography>
                    </span>
                  </div>

                  {canChooseResearch && hasSuitableResearch && (
                    <div className={styles.contractResearch}>
                      {kind === 'scientific' ? (
                        <>
                          <Typography variant="caption" tone="muted">
                            Научная сертификация по целевому сигналу
                          </Typography>
                          <NativeSelect
                            aria-label="Подходящая сертификация"
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
                            <option value="">Выберите сертификат</option>
                            {fittingCertifications.map((signal) => (
                              <option key={signal} value={signal}>{t(signalLabelKeys[signal])}</option>
                            ))}
                          </NativeSelect>
                        </>
                      ) : (
                        <>
                          <Typography variant="caption" tone="muted">
                            Подходящее неиспользованное исследование
                          </Typography>
                          <NativeSelect
                            aria-label="Подходящее исследование"
                            value={bid.evidenceTestIds[0] ?? ''}
                            onChange={(event) => {
                              const testId = event.target.value
                              const primary = primaryEvidence.find((entry) => entry.testId === testId)
                              setBids((previous) => ({
                                ...previous,
                                [contract.contractId]: {
                                  ...bid,
                                  evidenceTestIds: testId
                                    ? [
                                      testId,
                                      ...(primary?.protocol !== 'continuous' && bid.evidenceTestIds[1]
                                        ? [bid.evidenceTestIds[1]]
                                        : []),
                                    ]
                                    : [],
                                },
                              }))
                            }}
                          >
                            <option value="">Выберите исследование</option>
                            {selectablePrimaryEvidence.map((entry) => (
                              <option key={entry.testId} value={entry.testId}>{evidenceLabel(entry)}</option>
                            ))}
                          </NativeSelect>

                          {(kind === 'complex' || kind === 'final') && (
                            <>
                              <Typography variant="caption" tone="muted">
                                Непрерывного опыта достаточно. Для импульсного выберите второй опыт.
                              </Typography>
                              <NativeSelect
                                aria-label="Дополнительное исследование"
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
                                <option value="">Выберите второй опыт</option>
                                {secondaryEvidence.map((entry) => (
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
                        aria-label={`Подтвердить контракт ${contract.contractId}`}
                        disabled={disabled || !bidIsComplete}
                        onClick={() => void handleConfirmContract(contract.contractId, bid, reservedBySelf)}
                      >
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.7} aria-hidden="true" />
                        Подтвердить контракт
                      </Button>
                    </div>
                  )}

                  {!hasSuitableResearch
                    && !reservedByOther
                    && contract.bidOutcome === undefined
                    && (!isFinal || canResolve) && (
                    <Typography variant="bodySm" className={styles.noSuitableEvidence}>
                      Для этого контракта нет подходящих исследований.
                    </Typography>
                  )}

                  {contract.bidOutcome !== undefined && (
                    <Typography variant="caption" className={styles.reservedHint}>
                      {contract.bidOutcome === 'awarded' ? 'Контракт выполнен' : 'Заявка завершена'}
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
          <Typography variant="bodySm">Резервирование нельзя отменить или переключить на другой контракт.</Typography>
        </div>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">Успех обычного контракта: +1 Корпоративное доверие, без Бюджета.</Typography>
          <HugeiconsIcon icon={SignalFullIcon} strokeWidth={1.7} aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}
