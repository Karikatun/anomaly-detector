import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PowerAllocationPanel } from '../src/features/tender/PowerAllocationPanel'
import { I18nProvider } from '../src/platform/i18n'

const scenarioError = 'Сейчас нужно распределить Мощность по заданию обучения.'

test('keeps a rejected tutorial allocation visible beside confirmation', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <PowerAllocationPanel
        currentUserId="player-a"
        error={scenarioError}
        players={[
          { budget: 2, contractPowerRestriction: 0, displayName: 'Игрок', playerId: 'player-a', rating: 0 },
          { budget: 2, contractPowerRestriction: 0, displayName: 'Соперник', playerId: 'player-b', rating: 0 },
        ]}
        sampleCount={1}
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )
  const footerStart = html.indexOf('<footer')
  const footer = html.slice(footerStart, html.indexOf('</footer>', footerStart))

  expect(footer).toContain('role="alert"')
  expect(footer).toContain(scenarioError)
})
