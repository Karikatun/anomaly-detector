import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PublicContract } from '@anomaly-detector/contracts'

import { ContractsPanel } from '../src/features/tender/ContractsPanel'
import { I18nProvider } from '../src/platform/i18n'

const baseContract: PublicContract = {
  contractId: 'contract-1',
  kind: 'light',
  requiredPublicResult: 'reflection',
  targetRole: 'source',
  targetSignal: 'aster',
}

const renderPanel = (contract: PublicContract) => renderToStaticMarkup(
  <I18nProvider>
    <ContractsPanel
      certifications={[]}
      contracts={[contract]}
      journal={[]}
      maxPower={1}
      playerId="player-a"
      players={[{ budget: 2, contractPowerRestriction: 0, playerId: 'player-a', rating: 0 }]}
      round={1}
      onBid={async () => undefined}
      onReserve={async () => undefined}
      onSkip={async () => undefined}
    />
  </I18nProvider>,
)

test('offers an explicit skip instead of reservation when no Contract is eligible', () => {
  const html = renderPanel({ ...baseContract, eligibleForPlayer: false })

  expect(html).toContain('Пропустить ход')
  expect(html).not.toContain('>Зарезервировать<')
})

test('requires selecting an eligible Contract before reservation', () => {
  const html = renderPanel({ ...baseContract, eligibleForPlayer: true })

  expect(html).toContain('Выберите подходящий контракт')
  expect(html).toContain('>Зарезервировать<')
  expect(html).toContain('disabled=""')
})
