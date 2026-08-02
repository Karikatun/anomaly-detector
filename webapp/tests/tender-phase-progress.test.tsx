import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TenderPhaseProgress } from '../src/features/tender/components/TenderPhaseProgress'

test('mobile phase progress names the current stage and exposes the complete route', () => {
  const html = renderToStaticMarkup(<TenderPhaseProgress phase="model-analysis" />)

  expect(html).toContain('Этап 5 из 6 · Анализ модели')
  expect(html).toContain('Все этапы')
  expect(html).toContain('Выбор слота доступа')
  expect(html).toContain('Контракты')
})
