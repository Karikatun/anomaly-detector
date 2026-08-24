import { expect, test } from '@playwright/test'

import { registerBrowserUser } from '../helpers/test'

const origins = splitDomainOrigins()
const legacyPlayerPaths = [
  '/app',
  '/profile',
  '/feedback',
  '/rooms',
  '/rooms/legacy-room',
  '/tenders/legacy-tender',
  '/tutorial',
  '/recover/code',
  '/recover/password',
  '/privacy',
  '/personal-data-consent',
  '/terms',
]

test('serves the public root, redirects every legacy deep link, and enforces target CSP', async ({ page }) => {
  const rootResponse = await page.goto(origins.root)
  expect(rootResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', {
    name: 'Разгадайте аномалию раньше соперников',
  })).toBeVisible()

  const rootHeaders = await rootResponse?.allHeaders()
  expect(rootHeaders?.['content-security-policy']).toContain(
    `connect-src 'self' ${origins.api}`,
  )
  expect(rootHeaders?.['content-security-policy']).not.toContain('*')
  expect(rootHeaders?.['x-robots-tag']).toBeUndefined()

  for (const legalPath of ['/terms', '/privacy', '/personal-data-consent']) {
    await expect(page.locator(`a[href="${origins.app}${legalPath}"]`)).toHaveCount(1)
  }

  for (const path of legacyPlayerPaths) {
    const sourceUrl = `${origins.root}${path}?source=legacy`
    const redirectResponse = page.waitForResponse((response) => response.url() === sourceUrl)
    await page.goto(sourceUrl)
    const response = await redirectResponse

    expect(response.status(), path).toBe(302)
    expect(await response.headerValue('location'), path).toBe(
      `${origins.app}${path}?source=legacy`,
    )
    expect(await response.headerValue('cache-control'), path).toBe('no-store')
    expect(new URL(page.url()).origin, path).toBe(origins.app)
  }

  const missingResponse = await page.goto(`${origins.root}/not-a-public-or-player-route`)
  expect(missingResponse?.status()).toBe(404)

  const wwwSource = `${origins.www}/feedback?source=www`
  const wwwRedirect = page.waitForResponse((response) => response.url() === wwwSource)
  await page.goto(wwwSource)
  const wwwResponse = await wwwRedirect
  expect(wwwResponse.status()).toBe(301)
  expect(await wwwResponse.headerValue('location')).toBe(`${origins.root}/feedback?source=www`)
  expect(page.url()).toBe(`${origins.app}/feedback?source=www`)

  const playerResponse = await page.goto(`${origins.app}/feedback`)
  expect(playerResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  const playerHeaders = await playerResponse?.allHeaders()
  expect(playerHeaders?.['x-robots-tag']).toBe('noindex, nofollow, noarchive')
  expect(playerHeaders?.['content-security-policy']).toContain(
    `connect-src 'self' ${origins.api} ${origins.api.replace(/^http/, 'ws')}`,
  )

  const violatedDirective = await page.evaluate(() => new Promise<string>((resolveViolation, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('CSP did not block the probe')), 5_000)
    document.addEventListener('securitypolicyviolation', (event) => {
      window.clearTimeout(timeout)
      resolveViolation(event.violatedDirective)
    }, { once: true })
    const script = document.createElement('script')
    script.src = 'http://blocked.invalid/split-domain-preflight.js'
    document.body.append(script)
  }))
  expect(violatedDirective).toMatch(/^script-src/)
})

test('keeps the public root outside credentialed CORS and fixes both OAuth return origins', async ({ page }) => {
  await page.goto(origins.root)
  const publicCorsProbe = await oauthStartProbe(page, origins.api, origins.app)
  expect(publicCorsProbe).toEqual({ errorName: 'TypeError', outcome: 'blocked' })

  await page.goto(origins.app)
  const playerOAuth = await oauthStartProbe(page, origins.api, origins.app)
  expect(playerOAuth).toEqual({
    authorizationOrigin: 'https://oauth.yandex.ru',
    outcome: 'allowed',
    redirectUri: `${origins.api}/api/auth/oauth/yandex/callback`,
    status: 200,
  })

  await page.goto(
    `${origins.api}/api/auth/oauth/yandex/callback?error=access_denied&error_description=cancelled&state=split-domain-e2e`,
  )
  expect(page.url()).toBe(`${origins.app}/?auth_error=cancelled`)
})

test('keeps the secure refresh cookie host-only on the API auth path', async ({ page, context }) => {
  const registrationResponse = page.waitForResponse((response) =>
    response.url() === `${origins.api}/api/auth/register`
      && response.request().method() === 'POST')
  await registerBrowserUser(page, 'Split domain E2E', 'split-domain-target')

  const response = await registrationResponse
  const parsedCookies = (await response.headerValues('set-cookie')).map(parseSetCookie)
  const refreshHeader = parsedCookies.find((cookie) => cookie.name === 'anomaly_detector_refresh')
  expect(refreshHeader?.attributes).toContain('httponly')
  expect(refreshHeader?.attributes).toContain('secure')
  expect(refreshHeader?.attributes).toContain('samesite=none')
  expect(refreshHeader?.attributes).toContain('path=/api/auth')
  expect(refreshHeader?.attributes.some((attribute) => attribute.startsWith('domain='))).toBe(false)

  const refreshCookie = (await context.cookies())
    .find((cookie) => cookie.name === 'anomaly_detector_refresh')
  expect(refreshCookie?.domain).toBe('api.anomaly-detector.localhost')
  expect(refreshCookie?.path).toBe('/api/auth')
  expect(refreshCookie?.httpOnly).toBe(true)
  expect(refreshCookie?.secure).toBe(true)
  expect(refreshCookie?.sameSite).toBe('None')

  const echoPage = await context.newPage()
  expect(await cookieNamesAt(echoPage, `${origins.api}/api/auth/_cookie-echo`))
    .toContain('anomaly_detector_refresh')
  expect(await cookieNamesAt(echoPage, `${origins.api}/_cookie-echo`))
    .not.toContain('anomaly_detector_refresh')
  expect(await cookieNamesAt(echoPage, `${origins.root}/api/auth/_cookie-echo`))
    .not.toContain('anomaly_detector_refresh')
  expect(await cookieNamesAt(echoPage, `${origins.app}/api/auth/_cookie-echo`))
    .not.toContain('anomaly_detector_refresh')
  await echoPage.close()

  await page.goto(origins.app)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  expect((await context.cookies()).some((cookie) => cookie.name === 'anomaly_detector_refresh'))
    .toBe(false)
})

function splitDomainOrigins() {
  return {
    api: requiredEnvironment('E2E_SPLIT_API_ORIGIN'),
    app: requiredEnvironment('E2E_SPLIT_APP_ORIGIN'),
    root: requiredEnvironment('E2E_SPLIT_ROOT_ORIGIN'),
    www: requiredEnvironment('E2E_SPLIT_WWW_ORIGIN'),
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function oauthStartProbe(
  page: Parameters<typeof registerBrowserUser>[0],
  apiOrigin: string,
  webappOrigin: string,
) {
  return page.evaluate(async ({ apiOrigin: api, webappOrigin: webapp }) => {
    try {
      const response = await fetch(`${api}/api/auth/oauth/yandex/start`, {
        body: JSON.stringify({ webappOrigin: webapp }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const body = await response.json() as { authorizationUrl: string }
      const authorizationUrl = new URL(body.authorizationUrl)
      return {
        authorizationOrigin: authorizationUrl.origin,
        outcome: 'allowed',
        redirectUri: authorizationUrl.searchParams.get('redirect_uri'),
        status: response.status,
      }
    } catch (error) {
      return {
        errorName: error instanceof Error ? error.name : 'Unknown',
        outcome: 'blocked',
      }
    }
  }, { apiOrigin, webappOrigin })
}

function parseSetCookie(value: string) {
  const [nameValue = '', ...attributes] = value.split(';').map((part) => part.trim())
  return {
    attributes: attributes.map((attribute) => attribute.toLowerCase()),
    name: nameValue.split('=', 1)[0],
  }
}

async function cookieNamesAt(page: Parameters<typeof registerBrowserUser>[0], url: string) {
  const response = await page.goto(url)
  if (!response) throw new Error(`No response from cookie-scope probe at ${new URL(url).origin}`)
  const body = await response.json() as { cookieNames: string[] }
  return body.cookieNames
}
