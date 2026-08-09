import { expect, test } from 'bun:test'

import { createYandexOAuthProvider } from './oauth-yandex'

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
