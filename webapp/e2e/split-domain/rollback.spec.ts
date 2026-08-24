import { expect, test, type Page } from '@playwright/test'

import { registerBrowserUser } from '../helpers/test'

const origins = {
  api: requiredEnvironment('E2E_SPLIT_API_ORIGIN'),
  app: requiredEnvironment('E2E_SPLIT_APP_ORIGIN'),
  root: requiredEnvironment('E2E_SPLIT_ROOT_ORIGIN'),
  untrusted: requiredEnvironment('E2E_SPLIT_UNTRUSTED_ORIGIN'),
}

test('restores the player SPA and secure auth flow on the public root', async ({ page, context }) => {
  const deepLinkResponse = await page.goto(`${origins.root}/feedback`)
  expect(deepLinkResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  const headers = await deepLinkResponse?.allHeaders()
  expect(headers?.['x-robots-tag']).toBe('noindex, nofollow, noarchive')
  expect(headers?.['content-security-policy']).toContain(
    `connect-src 'self' ${origins.api} ${origins.api.replace(/^http/, 'ws')}`,
  )

  const appSource = `${origins.app}/feedback?source=rollback`
  const appRedirect = page.waitForResponse((response) => response.url() === appSource)
  await page.goto(appSource)
  const appResponse = await appRedirect
  expect(appResponse.status()).toBe(302)
  expect(await appResponse.headerValue('location')).toBe(
    `${origins.root}/feedback?source=rollback`,
  )
  expect(await appResponse.headerValue('cache-control')).toBe('no-store')
  expect(page.url()).toBe(`${origins.root}/feedback?source=rollback`)

  const missingResponse = await page.goto(`${origins.root}/rollback-spa-fallback`)
  expect(missingResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible()

  await registerBrowserUser(page, 'Rollback E2E', 'split-domain-rollback', origins.root)
  const refreshCookie = (await context.cookies())
    .find((cookie) => cookie.name === 'anomaly_detector_refresh')
  expect(refreshCookie?.domain).toBe('api.anomaly-detector.localhost')
  expect(refreshCookie?.path).toBe('/api/auth')
  expect(refreshCookie?.secure).toBe(true)

  await page.reload()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await page.goto(`${origins.root}/profile`)
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  expect((await context.cookies()).some((cookie) => cookie.name === 'anomaly_detector_refresh'))
    .toBe(false)
})

test('returns rollback OAuth to the root and excludes the previous app and other hosts from CORS', async ({ page }) => {
  await page.goto(origins.root)
  const rootOAuth = await oauthStartProbe(page, origins.api, origins.root)
  expect(rootOAuth).toEqual({
    authorizationOrigin: 'https://oauth.yandex.ru',
    outcome: 'allowed',
    redirectUri: `${origins.api}/api/auth/oauth/yandex/callback`,
    status: 200,
  })

  await page.goto(
    `${origins.api}/api/auth/oauth/yandex/callback?error=access_denied&error_description=rollback-cancelled&state=rollback-e2e`,
  )
  expect(page.url()).toBe(`${origins.root}/?auth_error=rollback-cancelled`)

  const cachedAppProbeUrl = `${origins.app}/_cached-before-rollback`
  await page.route(cachedAppProbeUrl, async (route) => {
    await route.fulfill({
      body: '<!doctype html><title>Cached pre-rollback app</title>',
      contentType: 'text/html; charset=utf-8',
      status: 200,
    })
  })
  await page.goto(cachedAppProbeUrl)
  expect(new URL(page.url()).origin).toBe(origins.app)
  const previousAppCorsProbe = await oauthStartProbe(page, origins.api, origins.root)
  expect(previousAppCorsProbe).toEqual({ errorName: 'TypeError', outcome: 'blocked' })

  await page.goto(origins.untrusted)
  const untrustedCorsProbe = await oauthStartProbe(page, origins.api, origins.root)
  expect(untrustedCorsProbe).toEqual({ errorName: 'TypeError', outcome: 'blocked' })
})

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function oauthStartProbe(page: Page, apiOrigin: string, webappOrigin: string) {
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
