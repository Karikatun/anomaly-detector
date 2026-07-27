import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PublicContract, ScientificJournalEntry } from '@anomaly-detector/contracts'

import { ContractsPanel } from '../src/features/tender/ContractsPanel'
import { I18nProvider } from '../src/platform/i18n'

const baseContract: PublicContract = {
  contractId: 'contract-1',
  kind: 'light',
  requiredPublicResult: 'reflection',
  targetRole: 'source',
  targetSignal: 'aster',
}

const renderPanel = (
  contract: PublicContract | PublicContract[],
  {
    certifications = [],
    journal = [],
    privateUsedContractEvidenceTestIds = [],
  }: {
    certifications?: ('aster' | 'boreal')[]
    journal?: ScientificJournalEntry[]
    privateUsedContractEvidenceTestIds?: string[]
  } = {},
) => renderToStaticMarkup(
  <I18nProvider>
    <ContractsPanel
      certifications={certifications}
      contracts={Array.isArray(contract) ? contract : [contract]}
      journal={journal}
      maxPower={1}
      playerId="player-a"
      players={[{ budget: 2, contractPowerRestriction: 0, playerId: 'player-a', rating: 0 }]}
      privateUsedContractEvidenceTestIds={privateUsedContractEvidenceTestIds}
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
  expect(html).not.toContain('>Подтвердить контракт<')
})

test('requires a complete research selection before Contract confirmation', () => {
  const html = renderPanel(
    { ...baseContract, eligibleForPlayer: true },
    {
      journal: [{
        playerId: 'player-a',
        protocol: 'impulse',
        publicResult: 'reflection',
        receiverSignal: 'boreal',
        sourceSignal: 'aster',
        testId: 'suitable',
      }],
    },
  )
  const confirmButton = html.match(/<button[^>]*aria-label="Подтвердить контракт contract-1"[^>]*>/)?.[0]

  expect(html).toContain('Выберите исследование')
  expect(html).toContain('>Подтвердить контракт<')
  expect(confirmButton).toContain('disabled=""')
  expect(html).not.toContain('Пропустить ход')
})

test('puts research selection inside an eligible Contract before reservation', () => {
  const html = renderPanel(
    { ...baseContract, eligibleForPlayer: true },
    {
      journal: [{
        playerId: 'player-a',
        protocol: 'impulse',
        publicResult: 'reflection',
        receiverSignal: 'boreal',
        sourceSignal: 'aster',
        testId: 'suitable',
      }],
    },
  )
  const cardStart = html.indexOf('data-contract-kind="light"')
  const cardEnd = html.indexOf('</article>', cardStart)
  const card = html.slice(cardStart, cardEnd)

  expect(html).not.toContain('aria-label="Подходящий контракт"')
  expect(card).toContain('aria-label="Подходящее исследование"')
  expect(card).toContain('value="suitable"')
  expect(card).toContain('>Подтвердить контракт<')
})

test('offers only suitable unused research in a reserved light Contract selector', () => {
  const journal: ScientificJournalEntry[] = [
    { playerId: 'player-a', protocol: 'impulse', publicResult: 'reflection', receiverSignal: 'boreal', sourceSignal: 'aster', testId: 'suitable' },
    { playerId: 'player-a', protocol: 'continuous', publicResult: 'reflection', receiverSignal: 'boreal', sourceSignal: 'aster', testId: 'used' },
    { playerId: 'player-a', protocol: 'impulse', publicResult: 'attenuation', receiverSignal: 'boreal', sourceSignal: 'aster', testId: 'wrong-result' },
  ]
  const html = renderPanel(
    { ...baseContract, eligibleForPlayer: true, reservedByPlayerId: 'player-a' },
    { journal, privateUsedContractEvidenceTestIds: ['used'] },
  )

  expect(html).toContain('aria-label="Подходящее исследование"')
  expect(html).toContain('value="suitable"')
  expect(html).not.toContain('value="used"')
  expect(html).not.toContain('value="wrong-result"')
  expect(html).not.toContain('Ваши доказательства')
})

test('explains when a reserved Contract has no suitable research', () => {
  const html = renderPanel({
    ...baseContract,
    eligibleForPlayer: true,
    reservedByPlayerId: 'player-a',
  })

  expect(html).toContain('Для этого контракта нет подходящих исследований.')
})

test('keeps only complete evidence paths selectable for a reserved complex Contract', () => {
  const journal: ScientificJournalEntry[] = [
    { playerId: 'player-a', protocol: 'impulse', publicResult: 'reflection', receiverSignal: 'boreal', sourceSignal: 'aster', testId: 'incomplete-impulse' },
    { playerId: 'player-a', protocol: 'continuous', publicResult: 'reflection', receiverSignal: 'boreal', sourceSignal: 'aster', testId: 'complete-continuous' },
  ]
  const html = renderPanel({
    ...baseContract,
    kind: 'complex',
    requiredSecondaryPublicResult: 'attenuation',
    reservedByPlayerId: 'player-a',
  }, { journal })

  expect(html).toContain('value="complete-continuous"')
  expect(html).not.toContain('value="incomplete-impulse"')
  expect(html).toContain('aria-label="Дополнительное исследование"')
})

test('removes every Contract control after the player confirms one Contract', () => {
  const html = renderPanel([
    {
      ...baseContract,
      awardedToPlayerId: 'player-a',
      bidOutcome: 'awarded',
      eligibleForPlayer: false,
      reservedByPlayerId: 'player-a',
    },
    {
      ...baseContract,
      contractId: 'contract-2',
      eligibleForPlayer: true,
    },
  ], {
    journal: [{
      playerId: 'player-a',
      protocol: 'impulse',
      publicResult: 'reflection',
      receiverSignal: 'boreal',
      sourceSignal: 'aster',
      testId: 'suitable',
    }],
  })

  expect(html).toContain('Контракт выполнен')
  expect(html).not.toContain('aria-label="Подходящее исследование"')
  expect(html).not.toContain('aria-label="Подтвердить контракт')
})
