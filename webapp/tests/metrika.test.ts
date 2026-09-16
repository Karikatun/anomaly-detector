import { describe, expect, test } from 'bun:test'

import {
  METRIKA_GOALS,
  MetrikaClient,
  isMetrikaOAuthLoginSuccess,
  isMetrikaSafePath,
  sanitizeMetrikaCounterId,
} from '../src/platform/analytics/metrika'

function fakeBrowser() {
  const calls: unknown[][] = []
  const scripts: Array<{ async?: boolean; src?: string }> = []
  const browserWindow: {
    ym?: (...args: unknown[]) => void
    location?: { pathname: string; search: string; hash: string }
    history?: { state: unknown; replaceState: (state: unknown, unused: string, url?: string) => void }
  } = {}
  browserWindow.location = { pathname: '/', search: '', hash: '' }
  const browserDocument = {
    createElement: () => ({ async: false, src: '' }),
    head: {
      appendChild: (script: { async?: boolean; src?: string }) => {
        scripts.push(script)
      },
    },
  }

  return { browserDocument, browserWindow, calls, scripts }
}

describe('MetrikaClient', () => {
  test('does not load or queue anything before explicit consent', () => {
    const browser = fakeBrowser()
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      window: browser.browserWindow,
    })

    client.record('tutorial_complete')

    expect(browser.scripts).toHaveLength(0)
    expect(browser.browserWindow.ym).toBeUndefined()
  })

  test('loads one tag and initializes it with privacy-safe options after consent', () => {
    const browser = fakeBrowser()
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      onCommand: (...args) => browser.calls.push(args),
      window: browser.browserWindow,
    })

    client.enable()
    client.enable()

    expect(browser.scripts).toEqual([{ async: true, src: 'https://mc.yandex.ru/metrika/tag.js' }])
    expect(browser.calls).toEqual([[
      112719766,
      'init',
      {
        accurateTrackBounce: true,
        clickmap: false,
        defer: true,
        ecommerce: false,
        sendTitle: false,
        trackLinks: false,
        webvisor: false,
      },
    ]])
  })

  test('removes query and fragment before enabling the tag', () => {
    const browser = fakeBrowser()
    const replaced: unknown[] = []
    browser.browserWindow.location = { pathname: '/', search: '?continue=tutorial-complete', hash: '#private' }
    browser.browserWindow.history = {
      state: { page: 1 },
      replaceState: (...args) => replaced.push(args),
    }
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      window: browser.browserWindow,
    })

    client.enable()

    expect(replaced).toEqual([[{ page: 1 }, '', '/']])
  })

  test('queues only allowlisted goals and ignores duplicate delivery', () => {
    const browser = fakeBrowser()
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      onCommand: (...args) => browser.calls.push(args),
      window: browser.browserWindow,
    })

    client.enable()
    for (const goal of METRIKA_GOALS) client.record(goal)
    client.record('login_success')
    client.record('login_success', 'second-transition')
    client.record('private_goal' as never)

    expect(browser.calls.slice(1)).toEqual([
      ...METRIKA_GOALS.map((goal) => [112719766, 'reachGoal', goal]),
      [112719766, 'reachGoal', 'login_success'],
    ])
  })

  test('stays disabled when the release flag is off', () => {
    const browser = fakeBrowser()
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: false,
      onCommand: (...args) => browser.calls.push(args),
      window: browser.browserWindow,
    })

    client.enable()
    client.record('registration_complete')

    expect(browser.scripts).toHaveLength(0)
    expect(browser.calls).toHaveLength(0)
  })

  test('does not initialize on private paths or record after private navigation', () => {
    const browser = fakeBrowser()
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      onCommand: (...args) => browser.calls.push(args),
      window: browser.browserWindow,
    })

    client.enable()
    browser.browserWindow.location = { pathname: '/rooms/private-room', search: '', hash: '' }
    client.record('tutorial_complete')

    expect(browser.scripts).toHaveLength(1)
    expect(browser.calls).toHaveLength(1)
  })

  test('does not initialize on a private path', () => {
    const browser = fakeBrowser()
    browser.browserWindow.location = { pathname: '/rooms/private-room', search: '', hash: '' }
    const client = new MetrikaClient({
      counterId: '112719766',
      document: browser.browserDocument,
      enabled: true,
      window: browser.browserWindow,
    })

    client.enable()

    expect(browser.scripts).toHaveLength(0)
    expect(browser.browserWindow.ym).toBeUndefined()
  })
})

test('accepts only a numeric counter id', () => {
  expect(sanitizeMetrikaCounterId('112719766')).toBe('112719766')
  expect(sanitizeMetrikaCounterId('123456789')).toBeUndefined()
  expect(sanitizeMetrikaCounterId('112719766?goal=secret')).toBeUndefined()
  expect(sanitizeMetrikaCounterId('')).toBeUndefined()
})

test('allows Metrika only on public auth and tutorial paths', () => {
  expect(isMetrikaSafePath('/')).toBe(true)
  expect(isMetrikaSafePath('/learn')).toBe(true)
  expect(isMetrikaSafePath('/tutorial')).toBe(false)
  expect(isMetrikaSafePath('/rooms/private-room')).toBe(false)
  expect(isMetrikaSafePath('/tenders/private-tender')).toBe(false)
})

test('does not classify OAuth registration as a login success', () => {
  expect(isMetrikaOAuthLoginSuccess('?analytics_registration=1')).toBe(false)
  expect(isMetrikaOAuthLoginSuccess('')).toBe(true)
})
