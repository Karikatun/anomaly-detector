import { describe, expect, test } from 'bun:test'

import {
  METRIKA_GOALS,
  MetrikaClient,
  MetrikaConsentStorage,
  isMetrikaOAuthLoginSuccess,
  isMetrikaOAuthRegistration,
  isMetrikaSafePath,
  clearMetrikaOAuthPending,
  createMetrikaOAuthPendingMarker,
  readMetrikaOAuthPending,
  sanitizeMetrikaCounterId,
  writeMetrikaOAuthPending,
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

test('classifies only a pending OAuth registration callback', () => {
  expect(isMetrikaOAuthRegistration('?analytics_registration=1', 'registration:transition')).toBe(true)
  expect(isMetrikaOAuthRegistration('?analytics_registration=1', 'login:transition')).toBe(false)
  expect(isMetrikaOAuthRegistration('?analytics_registration=1', null)).toBe(false)
  expect(isMetrikaOAuthRegistration('', 'registration:transition')).toBe(false)
})

test('keeps OAuth authentication unblocked when marker identity generation fails', () => {
  expect(createMetrikaOAuthPendingMarker(true, () => 'attempt-id')).toBe('registration:attempt-id')
  expect(createMetrikaOAuthPendingMarker(false, () => { throw new Error('crypto unavailable') })).toBeNull()
})

test('keeps authentication independent from unavailable session storage', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
  }

  expect(() => writeMetrikaOAuthPending('login:transition', unavailableStorage)).not.toThrow()
  expect(() => clearMetrikaOAuthPending(unavailableStorage)).not.toThrow()
  expect(readMetrikaOAuthPending(unavailableStorage)).toBeNull()
})

test('keeps the OAuth classification in memory when storage fails in the same navigation', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
  }

  writeMetrikaOAuthPending('registration:transition', unavailableStorage)

  expect(isMetrikaOAuthRegistration('?analytics_registration=1', readMetrikaOAuthPending(unavailableStorage))).toBe(true)

  clearMetrikaOAuthPending(unavailableStorage)
  expect(readMetrikaOAuthPending(unavailableStorage)).toBeNull()
})

test('does not cross-contaminate in-memory markers between storage contexts', () => {
  const firstStorage = {
    getItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
  }
  const secondStorage = {
    getItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
  }

  writeMetrikaOAuthPending('registration:first', firstStorage)

  expect(readMetrikaOAuthPending(secondStorage)).toBeNull()
  expect(readMetrikaOAuthPending(firstStorage)).toBe('registration:first')
})

test('does not let one concurrent OAuth cleanup erase the current marker', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
  }

  writeMetrikaOAuthPending('login:first', unavailableStorage)
  writeMetrikaOAuthPending('registration:second', unavailableStorage)
  clearMetrikaOAuthPending(unavailableStorage, 'login:first')

  expect(readMetrikaOAuthPending(unavailableStorage)).toBe('registration:second')
  clearMetrikaOAuthPending(unavailableStorage)
})

test('prefers a newer in-memory marker when a later storage write fails', () => {
  let stored: string | null = null
  let failWrites = false
  const storage = {
    getItem: () => stored,
    removeItem: () => { stored = null },
    setItem: (_key: string, value: string) => {
      if (failWrites) throw new Error('storage unavailable')
      stored = value
    },
  }

  writeMetrikaOAuthPending('login:first', storage)
  failWrites = true
  writeMetrikaOAuthPending('registration:second', storage)

  expect(readMetrikaOAuthPending(storage)).toBe('registration:second')
  clearMetrikaOAuthPending(storage, 'login:first')
  expect(readMetrikaOAuthPending(storage)).toBe('registration:second')
  clearMetrikaOAuthPending(storage, 'registration:second')
  expect(readMetrikaOAuthPending(storage)).toBeNull()
})


describe('MetrikaConsentStorage', () => {
  function consentStorage(failures: { read?: boolean; write?: boolean; remove?: boolean } = {}) {
    const values = new Map([['anomaly-detector:metrika-consent', 'allowed']])
    return {
      values,
      getItem: (key: string) => {
        if (failures.read) throw new Error('unavailable')
        return values.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        if (failures.write) throw new DOMException('Synthetic quota exhausted', 'QuotaExceededError')
        values.set(key, value)
      },
      removeItem: (key: string) => {
        if (failures.remove) throw new Error('unavailable')
        values.delete(key)
      },
    }
  }

  test('withdraws a persisted grant across reload when quota prevents writes', () => {
    const storage = consentStorage({ write: true })
    const consent = new MetrikaConsentStorage(storage)
    expect(consent.read()).toBe('allowed')

    expect(consent.save('necessary')).toBe(true)

    expect(consent.read()).toBe('necessary')
    expect(new MetrikaConsentStorage(storage).read()).not.toBe('allowed')
  })

  test('can persist denial when removal is unavailable', () => {
    const storage = consentStorage({ remove: true })
    const consent = new MetrikaConsentStorage(storage)
    expect(consent.save('necessary')).toBe(true)
    expect(new MetrikaConsentStorage(storage).read()).toBe('necessary')
  })

  test('reports failure and keeps the document denied when both mutations fail', () => {
    const consent = new MetrikaConsentStorage(consentStorage({ write: true, remove: true }))
    expect(consent.save('necessary')).toBe(false)
    expect(consent.read()).toBe('necessary')
    expect(consent.save('allowed')).toBe(false)
    expect(consent.read()).toBe('necessary')
  })

  test('never grants tracking from unreadable storage or an unsuccessful grant', () => {
    const storage = consentStorage({ read: true, write: true })
    const consent = new MetrikaConsentStorage(storage)
    expect(consent.read()).toBe('undecided')
    expect(consent.save('allowed')).toBe(false)
    expect(consent.read()).toBe('necessary')
  })

  test('persists normal grant, refusal and withdrawal choices', () => {
    const storage = consentStorage()
    const consent = new MetrikaConsentStorage(storage)
    for (const choice of ['necessary', 'allowed', 'necessary'] as const) {
      expect(consent.save(choice)).toBe(true)
      expect(new MetrikaConsentStorage(storage).read()).toBe(choice)
    }
  })
})


test('withdrawal stops a loaded counter and prevents goals or automatic reinitialization', () => {
  const browser = fakeBrowser()
  const providerCalls: unknown[][] = []
  browser.browserWindow.ym = (...args) => providerCalls.push(args)
  const client = new MetrikaClient({
    counterId: '112719766', document: browser.browserDocument, enabled: true, window: browser.browserWindow,
  })
  client.enable()
  client.disable()
  client.record('tutorial_complete')
  expect(client.enable()).toBe(false)
  expect(providerCalls.map((call) => call[1])).toEqual(['init', 'destruct'])
  expect(browser.scripts).toHaveLength(1)
})

test('withdrawal cancels pending initialization before the provider script loads', () => {
  const browser = fakeBrowser()
  const client = new MetrikaClient({
    counterId: '112719766', document: browser.browserDocument, enabled: true, window: browser.browserWindow,
  })
  client.enable()
  client.disable()
  client.record('tutorial_complete')
  expect((browser.browserWindow.ym as { a?: unknown[][] })?.a).toEqual([[112719766, 'destruct']])
})
