import { useState } from 'react'

import type { PublicContract, ScientificJournalEntry } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

type ContractBid = { evidenceTestIds: string[]; researchCertificationSignal?: string }

type ContractsPanelProps = {
  certifications: string[]
  contracts: PublicContract[]
  journal: ScientificJournalEntry[]
  maxPower: number
  playerId: string
  round: number
  disabled?: boolean
  error?: string | null
  onReserve: (contractId: string) => void
  onBid: (contractId: string, bid: ContractBid) => void
}

export function ContractsPanel({ certifications, contracts, journal, maxPower, playerId, round, disabled, error, onReserve, onBid }: ContractsPanelProps) {
  const [bids, setBids] = useState<Record<string, ContractBid>>({})
  const { t } = useI18n()
  const available = contracts.filter((contract) => !contract.reservedByPlayerId || contract.reservedByPlayerId === playerId)

  const handleReserve = (contractId: string) => {
    setBids((previous) => ({ ...previous, [contractId]: { evidenceTestIds: [] } }))
    onReserve(contractId)
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
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.contracts.title')}</CardTitle>
        <CardDescription>{t('tender.contracts.description', { count: maxPower })}</CardDescription>
      </CardHeader>
      <CardContent>
        {available.length === 0 && <Typography tone="muted">{t('tender.contracts.empty')}</Typography>}
        <div className="grid gap-4">
          {available.map((contract) => {
            const bid = bids[contract.contractId]
            const isScientific = contract.kind === 'scientific'
            const isFinal = contract.kind === 'final'
            const canResolve = !isFinal || round === 5
            const ownJournal = journal.filter((entry) => entry.playerId === playerId)
            return (
              <div key={contract.contractId} className="rounded-lg border p-4">
                <Typography variant="bodySm" className="font-medium">
                  {contract.contractId} · {contract.kind ?? 'light'} · +{contract.ratingReward ?? 2} рейтинг
                </Typography>
                <Typography variant="control" tone="muted">
                  {t('tender.contracts.required', { result: t(`tender.result.${contract.requiredPublicResult}`) })}
                </Typography>
                {contract.targetSignal && <Typography variant="control" tone="muted">Цель: {contract.targetRole ?? 'source'} = {contract.targetSignal}</Typography>}
                {contract.requiredSecondaryPublicResult && (contract.kind === 'complex' || isFinal) && (
                  <Typography variant="control" tone="muted">Альтернатива из двух тестов: {t(`tender.result.${contract.requiredSecondaryPublicResult}`)}</Typography>
                )}
                {isFinal && !canResolve && <Typography variant="control" tone="muted">Финальный контракт станет доступен в пятом раунде.</Typography>}

                {!bid && (
                  <Button type="button" size="sm" className="mt-3 w-full" disabled={disabled || maxPower === 0 || !canResolve} onClick={() => handleReserve(contract.contractId)}>
                    {t('tender.contracts.reserve')}
                  </Button>
                )}
                {bid && (
                  <div className="mt-3 grid gap-2">
                    {isScientific ? (
                      <NativeSelect
                        value={bid.researchCertificationSignal ?? ''}
                        onChange={(event) => setBids((previous) => ({ ...previous, [contract.contractId]: { ...bid, researchCertificationSignal: event.target.value || undefined } }))}
                      >
                        <option value="">Выберите сертификат</option>
                        {certifications.map((signal) => <option key={signal} value={signal}>{signal}</option>)}
                      </NativeSelect>
                    ) : (
                      <>
                        <Typography variant="control" tone="muted">Выберите доказательство из собственного журнала{contract.kind === 'complex' || isFinal ? ' (одно непрерывное или два разных)' : ''}.</Typography>
                        {ownJournal.map((entry) => (
                          <Button key={entry.testId} type="button" size="sm" variant={bid.evidenceTestIds.includes(entry.testId) ? 'default' : 'outline'} onClick={() => toggleEvidence(contract.contractId, entry.testId)}>
                            {entry.testId}: {entry.sourceSignal} → {entry.receiverSignal}, {t(`tender.result.${entry.publicResult}`)}
                          </Button>
                        ))}
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={disabled || (isScientific ? !bid.researchCertificationSignal : bid.evidenceTestIds.length === 0)}
                      onClick={() => {
                        onBid(contract.contractId, bid)
                        setBids((previous) => {
                          const next = { ...previous }
                          delete next[contract.contractId]
                          return next
                        })
                      }}
                    >
                      {t('tender.contracts.submit')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {error && <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">{error}</Typography>}
      </CardContent>
    </Card>
  )
}
