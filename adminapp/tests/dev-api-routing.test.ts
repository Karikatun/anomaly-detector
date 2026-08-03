import { expect, test } from 'bun:test'

import viteConfig from '../vite.config'
import { resolveApiBaseUrl } from '../src/api-base-url'

test('routes local admin API requests through the same-origin Vite proxy', () => {
  expect(resolveApiBaseUrl(undefined)).toBe('')
  expect(resolveApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com')

  expect(viteConfig).toBeObject()
  if (typeof viteConfig === 'function') throw new Error('Expected a static Vite config')
  expect(viteConfig.server?.proxy?.['/api']).toMatchObject({
    target: 'http://localhost:3000',
  })
})
