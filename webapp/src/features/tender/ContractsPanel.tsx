import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  TestTube01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type {
  PublicContract,
  ScientificJournalEntry,
  SignalId,
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
  round: number
  disabled?: boolean
  error?: string | null
  onReserve: (contractId: string) => Promise<void>
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
  round,
  disabled,
  error,
  onReserve,
  onBid,
}: ContractsPanelProps) {
  const [bids, setBids] = useState<Record<string, ContractBid>>({})
  const { t } = useI18n()
  const available = contracts.filter((contract) => !contract.reservedByPlayerId || contract.reservedByPlayerId === playerId)
  const ownJournal = journal.filter((entry) => entry.playerId === playerId)

  const handleReserve = async (contractId: string) => {
    try {
      await onReserve(contractId)
      setBids((previous) => ({ ...previous, [contractId]: { evidenceTestIds: [] } }))
    } catch {
      // The parent owns the visible command error; keep the action available.
    }
  }

  const handleBid = async (contractId: string, bid: ContractBid) => {
    try {
      await onBid(contractId, bid)
      setBids((previous) => {
        const next = { ...previous }
        delete next[contractId]
        return next
      })
    } catch {
      // The parent owns the visible command error; keep the bid for retry.
    }
  }

  const toggleEvidence = (contractId: string, testId: string) => {
    setBids((previous) => {
      const bid = previous[contractId] ?? { evidenceTestIds: [] }
      const evidenceTestIds = bid.evidenceTestIds.includes(testId)
        ? bid.evidenceTestIds.filter((id) => id !== testId)
        : bid.evidenceTestIds.length < 2 ? [...bid.evidenceTestIds, testId] : bid.evidenceTestIds
      return { ...previous, [contractId]: { ...bid, evidenceTestIds } }
    })
  }

  return (
    <section className={styles.panel} aria-labelledby="contracts-heading">
      <div className={`${styles.surface} ${styles.intro}`}>
        <div className={styles.sectionHeader}>
          <Typography id="contracts-heading" as="h2" variant="h4" className={styles.title}>
            Доступные контракты
          </Typography>
          <Typography as="span" variant="caption" className={styles.sectionMeta}>{maxPower} мощности</Typography>
        </div>
        <Typography variant="bodySm" className={styles.description}>
          Резервирование публично и окончательно. После выбора приложите подходящее доказательство.
        </Typography>
      </div>

      <div className={styles.surface}>
        {available.length === 0 && <Typography tone="muted">{t('tender.contracts.empty')}</Typography>}
        <div className={styles.contractGrid}>
          {available.map((contract) => {
            const kind = contract.kind ?? 'light'
            const bid = bids[contract.contractId]
            const isScientific = kind === 'scientific'
            const isFinal = kind === 'final'
            const canResolve = !isFinal || round === 5
            const accent = kindAccents[kind]
            const target = contract.targetSignal
            const contractStyle = {
              '--contract-accent': accent,
              ...(target ? { '--signal-accent': signalAccent(target) } : {}),
            } as CSSProperties

            return (
              <article
                key={contract.contractId}
                className={`${styles.contractCard} ${isFinal ? styles.finalContract : ''}`}
                data-active={bid !== undefined || undefined}
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
                      {isFinal && !canResolve ? 'Доступен в раунде 5' : 'Свободен'}
                    </Typography>
                  </span>
                </div>

                {!bid ? (
                  <Button
                    type="button"
                    size="sm"
                    aria-label={t('tender.contracts.reserveAria', { id: contract.contractId })}
                    disabled={disabled || maxPower === 0 || !canResolve}
                    onClick={() => void handleReserve(contract.contractId)}
                  >
                    {isFinal && !canResolve ? 'Заблокировано' : t('tender.contracts.reserve')}
                  </Button>
                ) : (
                  <div className={styles.evidencePanel}>
                    <Typography variant="caption" tone="muted">
                      {isScientific ? 'Выберите личную сертификацию' : 'Выберите доказательство из своего журнала'}
                    </Typography>
                    {isScientific ? (
                      <NativeSelect
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
                        {certifications.map((signal) => (
                          <option key={signal} value={signal}>{t(signalLabelKeys[signal])}</option>
                        ))}
                      </NativeSelect>
                    ) : (
                      ownJournal.map((entry) => (
                        <Button
                          key={entry.testId}
                          type="button"
                          size="sm"
                          variant={bid.evidenceTestIds.includes(entry.testId) ? 'default' : 'outline'}
                          className={styles.evidenceButton}
                          onClick={() => toggleEvidence(contract.contractId, entry.testId)}
                        >
                          {t(signalLabelKeys[entry.sourceSignal])} → {t(signalLabelKeys[entry.receiverSignal])}
                          {' · '}{t(`tender.result.${entry.publicResult}`)}
                        </Button>
                      ))
                    )}
                    <Button
                      type="button"
                      size="sm"
                      aria-label={t('tender.contracts.submitAria', { id: contract.contractId })}
                      disabled={disabled || (isScientific ? !bid.researchCertificationSignal : bid.evidenceTestIds.length === 0)}
                      onClick={() => void handleBid(contract.contractId, bid)}
                    >
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.7} aria-hidden="true" />
                      {t('tender.contracts.submit')}
                    </Button>
                  </div>
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
        <Typography variant="bodySm">Успешный обычный контракт даёт +1 Corporate Trust и не даёт Бюджет.</Typography>
        <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
      </div>
    </section>
  )
}
