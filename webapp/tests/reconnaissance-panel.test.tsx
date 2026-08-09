import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ReconnaissancePanel } from '../src/features/tender/ReconnaissancePanel'
import { I18nProvider } from '../src/platform/i18n'

test('keeps reconnaissance state and command feedback visible without hover', () => {
  const commandError = 'Цели разведки изменились. Выберите их ещё раз.'
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ReconnaissancePanel
        error={commandError}
        knownSignals={['aster', 'boreal']}
        maxSignals={2}
        mySamples={['aster']}
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )
  const footerStart = html.indexOf('<footer')
  const footer = html.slice(footerStart, html.indexOf('</footer>', footerStart))

  expect(html.match(/aria-pressed="false"/g)).toHaveLength(3)
  expect(html.match(/Не выбрана/g)).toHaveLength(2)
  expect(html).toContain('Изучено')
  expect(footer).toContain('role="alert"')
  expect(footer).toContain(commandError)
})
