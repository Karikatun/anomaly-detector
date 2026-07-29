import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { LaboratoryInterpretation } from '../src/features/rules/RulesReferenceDialog'
import { I18nProvider } from '../src/platform/i18n'

const renderInterpretation = (ruleset: 'tender-v1' | 'tender-v2') => renderToStaticMarkup(
  <I18nProvider>
    <LaboratoryInterpretation ruleset={ruleset} />
  </I18nProvider>,
)

test('selects Laboratory rules from the active Tender ruleset', () => {
  expect(renderInterpretation('tender-v1')).not.toContain('Широкое исследование')
  expect(renderInterpretation('tender-v2')).toContain('Широкое исследование')
})
