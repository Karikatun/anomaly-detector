import { expect, test } from 'bun:test'

import { createYandexOAuthProvider } from './oauth-yandex'

test('Yandex OAuth requires email access and returns the bounded default email', async () => {
  const provider = createYandexOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetcher: async (input) => {
      expect(String(input)).toBe('https://login.yandex.ru/info?format=json')
      return Response.json({
        id: 'provider-subject',
        display_name: 'Исследователь',
        default_email: 'Player@Яндекс.рф',
      })
    },
  })

  const authorizationUrl = new URL(provider.authorizationUrl({
    codeChallenge: 'challenge',
    redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
    state: 'state',
  }))

  expect(authorizationUrl.searchParams.get('scope')).toBe('login:email')
  await expect(provider.getUserInfo('provider-token')).resolves.toEqual({
    accountEmail: 'Player@Яндекс.рф',
    displayName: 'Исследователь',
    providerSubject: 'provider-subject',
  })
})

test('Yandex OAuth rejects oversized user-info responses without exposing their payload', async () => {
  const providerPayload = `private-address-${'x'.repeat(20_000)}@example.test`
  const provider = createYandexOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetcher: async () => Response.json({
      id: 'provider-subject',
      default_email: providerPayload,
    }),
  })

  const failure = provider.getUserInfo('provider-token')

  await expect(failure).rejects.toThrow('Yandex user info returned an invalid response')
  await expect(failure).rejects.not.toThrow('private-address')
})

test('Yandex OAuth requests have a timeout signal and redact provider response bodies', async () => {
  const provider = createYandexOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetcher: async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response('provider-secret-diagnostic', { status: 502 })
    },
    requestTimeoutMs: 50,
  })

  const failure = provider.exchangeCode({
    code: 'authorization-code',
    codeVerifier: 'verifier',
    redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
  })

  await expect(failure).rejects.toThrow('Yandex token exchange failed: 502')
  await expect(failure).rejects.not.toThrow('provider-secret-diagnostic')
})
