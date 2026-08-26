import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TenderTerminalState } from '../src/features/tender/components/TenderTerminalState'

test.each([
  ['audit', 'Итоговый аудит недоступен', 'Сохранённые данные этого матча нельзя безопасно восстановить'],
  ['access', 'Матч недоступен', 'Не удалось открыть этот матч'],
] as const)('renders a safe %s terminal state with recovery actions', (kind, title, description) => {
  const html = renderToStaticMarkup(
    <TenderTerminalState
      kind={kind}
      onRetry={() => undefined}
      onReturnToHistory={() => undefined}
    />,
  )

  expect(html).toContain(title)
  expect(html).toContain(description)
  expect(html).toContain('Повторить')
  expect(html).toContain('В Историю матчей')
  expect(html).not.toContain('TenderAuditEventDecodeError')
  expect(html).not.toContain('historical_data_incompatible')
  expect(html).not.toContain('playerId')
})
