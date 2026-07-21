import { useState } from 'react'

import type { PublicContract } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'

const resultLabels: Record<string, string> = {
  attenuation: 'Ослабление',
  reflection: 'Отражение',
  transmission_gain: 'Усиление',
  unstable_collapse: 'Нестабильный срыв',
}

type ContractsPanelProps = {
  contracts: PublicContract[]
  maxPower: number
  disabled?: boolean
  error?: string | null
  onReserve: (contractId: string) => void
  onBid: (contractId: string, claimedPublicResult: string, requestedFunding: number) => void
}

export function ContractsPanel({ contracts, maxPower, disabled, error, onReserve, onBid }: ContractsPanelProps) {
  type BidDraft = { claimedPublicResult: string; requestedFunding: number }
  const [bids, setBids] = useState<Record<string, BidDraft>>({})

  const available = contracts.filter((c) => !c.reservedByPlayerId)

  const handleReserve = (contractId: string) => {
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
        <CardTitle>Контракты</CardTitle>
        <CardDescription>
          Зарезервируйте и выполните контракт. Доступно {maxPower} мощности.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {available.length === 0 && (
          <Typography tone="muted">Нет доступных контрактов.</Typography>
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
                  Требуется: {resultLabels[contract.requiredPublicResult] ?? contract.requiredPublicResult}
                </Typography>

                {!draft && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={disabled || maxPower === 0}
                    onClick={() => handleReserve(contract.contractId)}
                  >
                    Зарезервировать
                  </Button>
                )}

                {draft && (
                  <div className="mt-3 grid gap-2">
                    <NativeSelect
                      value={draft.claimedPublicResult}
                      onChange={(e) => setBids((prev) => ({
                        ...prev,
                        [contract.contractId]: { ...draft, claimedPublicResult: e.target.value },
                      }))}
                    >
                      <option value="">Результат в заявке…</option>
                      {Object.entries(resultLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </NativeSelect>
                    <div className="flex items-center gap-2">
                      <Typography variant="control" tone="muted">Бюджет:</Typography>
                      <NativeSelect
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
                      disabled={disabled || !draft.claimedPublicResult}
                      onClick={() => handleBid(contract.contractId)}
                    >
                      Подать заявку
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
