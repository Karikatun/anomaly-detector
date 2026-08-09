import { expect, test } from 'bun:test'

import { OAuthProviderFailure } from '../application/ports'
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

  await expect(failure).rejects.toMatchObject({
    reason: 'http_status',
    stage: 'token_exchange',
    status: 502,
  } satisfies Partial<OAuthProviderFailure>)
  await expect(failure).rejects.not.toThrow('provider-secret-diagnostic')
})

test('Yandex OAuth classifies invalid provider payloads without retaining their contents', async () => {
  const provider = createYandexOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetcher: async () => new Response('{"unexpected":"provider-secret-diagnostic"}', { status: 200 }),
  })

  const failure = provider.exchangeCode({
    code: 'authorization-code',
    codeVerifier: 'verifier',
    redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
  })

  await expect(failure).rejects.toMatchObject({
    reason: 'invalid_response',
    stage: 'token_exchange',
  } satisfies Partial<OAuthProviderFailure>)
  await expect(failure).rejects.not.toThrow('provider-secret-diagnostic')
})
