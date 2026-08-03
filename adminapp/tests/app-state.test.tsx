import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ConcealedScreen } from '../src/app'

test('offers a way to switch users when an existing session is not an admin', () => {
  const html = renderToStaticMarkup(<ConcealedScreen onSwitchUser={() => undefined} />)

  expect(html).toContain('Ресурс недоступен')
  expect(html).toContain('Войти другим пользователем')
})
