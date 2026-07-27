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
import { TenderPlayers } from './components/TenderOverview'

type ContractBid = { evidenceTestIds: string[]; researchCertificationSignal?: SignalId }

type ContractsPanelProps = {
  activePlayerId?: string
  certifications: SignalId[]
  contracts: PublicContract[]
  journal: ScientificJournalEntry[]
  maxPower: number
  playerId: string
  players: TenderView['players']
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
  activePlayerId,
  certifications,
  contracts,
  journal,
  maxPower,
  playerId,
  players,
  round,
  disabled,
  error,
  onReserve,
  onSkip,
  onBid,
}: ContractsPanelProps) {
  const [bids, setBids] = useState<Record<string, ContractBid>>({})
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null)
  const { t } = useI18n()
  const ownJournal = journal.filter((entry) => entry.playerId === playerId)
  const reservedContract = contracts.find((contract) => contract.reservedByPlayerId === playerId)
  const selectedContract = reservedContract
    ?? contracts.find((contract) => contract.contractId === selectedContractId)
  const selectedBid = selectedContract ? bids[selectedContract.contractId] : undefined
  const eligibleContracts = contracts.filter((contract) => contract.eligibleForPlayer)

  const handleReserve = async (contractId: string) => {
    setSelectedContractId(contractId)
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

  const evidenceFits = (entry: ScientificJournalEntry, contract?: PublicContract) => {
    if (!contract || contract.kind === 'scientific') return false
    const role = contract.targetRole ?? 'source'
    const signalMatches = entry[role === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal
    const resultMatches = entry.publicResult === contract.requiredPublicResult
      || entry.publicResult === contract.requiredSecondaryPublicResult
    return signalMatches && resultMatches
  }

  return (
    <section className={styles.contractsWorkspace} aria-labelledby="contracts-heading">
      <aside className={styles.contractPlayers}>
        <TenderPlayers activePlayerId={activePlayerId} currentUserId={playerId} players={players} />
      </aside>

      <div className={styles.contractsMain}>
        <div className={`${styles.surface} ${styles.intro}`}>
          <div className={styles.sectionHeader}>
            <Typography id="contracts-heading" as="h2" variant="h4" className={styles.title}>
              Доступные контракты
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{maxPower} мощности</Typography>
          </div>
          <Typography variant="bodySm" className={styles.description}>
            Выберите контракт и заранее проверьте подходящие доказательства.
          </Typography>
        </div>

        <div className={styles.surface}>
          {contracts.length === 0 && <Typography tone="muted">{t('tender.contracts.empty')}</Typography>}
          {!reservedContract && (
            <div className={styles.contractSelection}>
              <NativeSelect
                aria-label="Подходящий контракт"
                value={selectedContractId ?? ''}
                disabled={disabled || eligibleContracts.length === 0}
                onChange={(event) => setSelectedContractId(event.target.value || null)}
              >
                <option value="">Выберите подходящий контракт</option>
                {eligibleContracts.map((contract) => (
                  <option key={contract.contractId} value={contract.contractId}>
                    {contract.targetSignal
                      ? `${t(signalLabelKeys[contract.targetSignal])} · ${t(`tender.contracts.kind.${contract.kind ?? 'light'}`)}`
                      : contract.contractId}
                  </option>
                ))}
              </NativeSelect>
              {eligibleContracts.length > 0 ? (
                <Button
                  type="button"
                  disabled={disabled || !selectedContractId}
                  onClick={() => selectedContractId && void handleReserve(selectedContractId)}
                >
                  {t('tender.contracts.reserve')}
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled={disabled} onClick={() => void onSkip()}>
                  Пропустить ход
                </Button>
              )}
            </div>
          )}
          <div className={styles.contractGrid}>
            {contracts.map((contract) => {
              const kind = contract.kind ?? 'light'
              const bid = bids[contract.contractId]
              const isFinal = kind === 'final'
              const canResolve = !isFinal || round === 5
              const reservedByOther = Boolean(contract.reservedByPlayerId && contract.reservedByPlayerId !== playerId)
              const reservedByName = players.find((candidate) => candidate.playerId === contract.reservedByPlayerId)?.displayName
              const target = contract.targetSignal
              const contractStyle = {
                '--contract-accent': kindAccents[kind],
                ...(target ? { '--signal-accent': signalAccent(target) } : {}),
              } as CSSProperties

              return (
                <article
                  key={contract.contractId}
                  className={`${styles.contractCard} ${isFinal ? styles.finalContract : ''}`}
                  data-active={selectedContract?.contractId === contract.contractId || undefined}
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
                              : isFinal && !canResolve ? 'Доступен в раунде 5' : 'Свободен'}
                      </Typography>
                    </span>
                  </div>

                  {(bid || contract.bidOutcome !== undefined || reservedByOther || !canResolve) && (
                    <Typography variant="caption" className={styles.reservedHint}>
                      {contract.bidOutcome === 'awarded'
                        ? 'Контракт выполнен'
                        : contract.bidOutcome === 'failed'
                          ? 'Заявка завершена'
                          : 'Зафиксирован · доказательства справа'}
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
      </div>

      <aside className={`${styles.surface} ${styles.contractEvidence}`}>
        <div className={styles.sectionHeader}>
          <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Ваши доказательства</Typography>
          <Typography as="span" variant="caption" className={styles.sectionMeta}>Видите только вы</Typography>
        </div>

        {!selectedContract ? (
          <Typography variant="bodySm" tone="muted">Выберите контракт, чтобы проверить доказательства.</Typography>
        ) : selectedContract.kind === 'scientific' ? (
          <div className={styles.evidencePanel}>
            <Typography variant="caption" tone="muted">Личные научные сертификации</Typography>
            {certifications.length === 0 && <Typography variant="bodySm" tone="muted">Нет доступных сертификаций.</Typography>}
            {certifications.map((signal) => {
              const fits = signal === selectedContract.targetSignal
              return (
                <div key={signal} className={styles.evidenceRow} data-fits={fits || undefined}>
                  <SignalGlyph signal={signal} className={styles.signalGlyph} />
                  <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
                  <Typography as="span" variant="caption">{fits ? 'Подходит' : 'Не подходит'}</Typography>
                </div>
              )
            })}
            {selectedBid && (
              <NativeSelect
                value={selectedBid.researchCertificationSignal ?? ''}
                onChange={(event) => setBids((previous) => ({
                  ...previous,
                  [selectedContract.contractId]: {
                    ...selectedBid,
                    researchCertificationSignal: event.target.value ? event.target.value as SignalId : undefined,
                  },
                }))}
              >
                <option value="">Выберите сертификат</option>
                {certifications.filter((signal) => signal === selectedContract.targetSignal).map((signal) => (
                  <option key={signal} value={signal}>{t(signalLabelKeys[signal])}</option>
                ))}
              </NativeSelect>
            )}
          </div>
        ) : (
          <div className={styles.evidencePanel}>
            <Typography variant="caption" tone="muted">Неиспользованные опыты</Typography>
            {ownJournal.length === 0 && <Typography variant="bodySm" tone="muted">В журнале пока нет ваших опытов.</Typography>}
            {ownJournal.map((entry) => {
              const fits = evidenceFits(entry, selectedContract)
              const selected = selectedBid?.evidenceTestIds.includes(entry.testId) ?? false
              return (
                <button
                  key={entry.testId}
                  type="button"
                  className={styles.evidenceRow}
                  data-evidence
                  data-fits={fits || undefined}
                  data-selected={selected || undefined}
                  disabled={!selectedBid}
                  onClick={() => toggleEvidence(selectedContract.contractId, entry.testId)}
                >
                  <SignalGlyph signal={entry.sourceSignal} className={styles.signalGlyph} />
                  <span>
                    <Typography as="strong" variant="bodySmMedium">
                      {t(signalLabelKeys[entry.sourceSignal])} → {t(signalLabelKeys[entry.receiverSignal])}
                    </Typography>
                    <Typography as="span" variant="caption" tone="muted">
                      {t(`tender.result.${entry.publicResult}`)}
                    </Typography>
                  </span>
                  <Typography as="span" variant="caption">{fits ? 'Подходит' : 'Не подходит'}</Typography>
                </button>
              )
            })}
          </div>
        )}

        {selectedBid && selectedContract && (
          <Button
            type="button"
            size="sm"
            aria-label={t('tender.contracts.submitAria', { id: selectedContract.contractId })}
            disabled={disabled || (selectedContract.kind === 'scientific'
              ? !selectedBid.researchCertificationSignal
              : selectedBid.evidenceTestIds.length === 0)}
            onClick={() => void handleBid(selectedContract.contractId, selectedBid)}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.7} aria-hidden="true" />
            {t('tender.contracts.submit')}
          </Button>
        )}

        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">Успех обычного контракта: +1 Corporate Trust, без Бюджета.</Typography>
          <HugeiconsIcon icon={SignalFullIcon} strokeWidth={1.7} aria-hidden="true" />
        </div>
      </aside>
    </section>
  )
}
