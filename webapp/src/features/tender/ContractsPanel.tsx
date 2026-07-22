import { useState } from 'react'

import type { PublicContract } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const resultIds = ['attenuation', 'reflection', 'transmission_gain', 'unstable_collapse'] as const

type ContractsPanelProps = {
  contracts: PublicContract[]
  maxPower: number
  playerId: string
  disabled?: boolean
  error?: string | null
  onReserve: (contractId: string) => void
  onBid: (contractId: string, claimedPublicResult: string, requestedFunding: number) => void
}

export function ContractsPanel({ contracts, maxPower, playerId, disabled, error, onReserve, onBid }: ContractsPanelProps) {
  type BidDraft = { claimedPublicResult: string; requestedFunding: number }
  const [bids, setBids] = useState<Record<string, BidDraft>>({})
  const { t } = useI18n()

  const available = contracts.filter((contract) =>
    !contract.reservedByPlayerId || contract.reservedByPlayerId === playerId,
  )

  const handleReserve = (contractId: string) => {
    setBids((previous) => ({
      ...previous,
      [contractId]: { claimedPublicResult: '', requestedFunding: 0 },
    }))
    onReserve(contractId)
  }

  const handleBid = (contractId: string) => {
    const draft = bids[contractId]
    if (draft) {
      onBid(contractId, draft.claimedPublicResult, draft.requestedFunding)
      setBids((prev) => {
        const next = { ...prev }
        delete next[contractId]
        return next
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.contracts.title')}</CardTitle>
        <CardDescription>
          {t('tender.contracts.description', { count: maxPower })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {available.length === 0 && (
          <Typography tone="muted">{t('tender.contracts.empty')}</Typography>
        )}

        <div className="grid gap-4">
          {available.map((contract) => {
            const draft = bids[contract.contractId]
            return (
              <div key={contract.contractId} className="rounded-lg border p-4">
                <Typography variant="bodySm" className="font-medium">
                  {contract.contractId}
                </Typography>
                <Typography variant="control" tone="muted">
                  {t('tender.contracts.required', { result: t(`tender.result.${contract.requiredPublicResult}`) })}
                </Typography>
                {contract.targetSignal && (
                  <Typography variant="control" tone="muted">
                    {contract.targetSignal}
                  </Typography>
                )}

                {!draft && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    aria-label={t('tender.contracts.reserveAria', { id: contract.contractId })}
                    disabled={disabled || maxPower === 0}
                    onClick={() => handleReserve(contract.contractId)}
                  >
                    {t('tender.contracts.reserve')}
                  </Button>
                )}

                {draft && (
                  <div className="mt-3 grid gap-2">
                    <NativeSelect
                      aria-label={t('tender.contracts.bidResultAria', { id: contract.contractId })}
                      value={draft.claimedPublicResult}
                      onChange={(e) => setBids((prev) => ({
                        ...prev,
                        [contract.contractId]: { ...draft, claimedPublicResult: e.target.value },
                      }))}
                    >
                      <option value="">{t('tender.contracts.bidResultPlaceholder')}</option>
                      {resultIds.map((value) => (
                        <option key={value} value={value}>{t(`tender.result.${value}`)}</option>
                      ))}
                    </NativeSelect>
                    <div className="flex items-center gap-2">
                      <Typography variant="control" tone="muted">{t('tender.contracts.budget')}</Typography>
                      <NativeSelect
                        aria-label={t('tender.contracts.budgetAria', { id: contract.contractId })}
                        value={String(draft.requestedFunding)}
                        onChange={(e) => setBids((prev) => ({
                          ...prev,
                          [contract.contractId]: { ...draft, requestedFunding: Number(e.target.value) },
                        }))}
                      >
                        {[0, 1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      aria-label={t('tender.contracts.submitAria', { id: contract.contractId })}
                      disabled={disabled || !draft.claimedPublicResult}
                      onClick={() => handleBid(contract.contractId)}
                    >
                      {t('tender.contracts.submit')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
