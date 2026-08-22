import { expect, test } from 'bun:test'

import { buildFeedbackTechnicalContext } from '../src/features/feedback/technical-context'

test('reduces browser, device and route to approved coarse values', () => {
  expect(buildFeedbackTechnicalContext({
    buildSha: 'A'.repeat(40),
    pathname: '/tenders/019f8099-7e26-7760-ad08-66d1d66b2718',
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    viewportWidth: 1_280,
  })).toEqual({
    browserClass: 'chromium',
    buildSha: 'a'.repeat(40),
    deviceClass: 'desktop',
    errorId: null,
    routeTemplate: '/tenders/$tenderId',
  })
})

test('never returns a raw unknown path, query, fragment or user agent', () => {
  const context = buildFeedbackTechnicalContext({
    buildSha: 'not-a-sha',
    pathname: '/private/secret-id?token=secret#fragment',
    userAgent: 'Private Browser Agent With Device Serial',
    viewportWidth: 390,
  })

  expect(context).toEqual({
    browserClass: 'other',
    buildSha: null,
    deviceClass: 'mobile',
    errorId: null,
    routeTemplate: 'unknown',
  })
  expect(JSON.stringify(context)).not.toMatch(/secret|serial|private/i)
})
