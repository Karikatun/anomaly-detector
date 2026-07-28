import { z } from 'zod'

import type { OAuthProvider } from '../application/ports'

type YandexOAuthConfig = {
  clientId: string
  clientSecret: string
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  requestTimeoutMs?: number
}

export function createYandexOAuthProvider(config: YandexOAuthConfig): OAuthProvider {
  const authorizationBase = 'https://oauth.yandex.ru/authorize'
  const tokenUrl = 'https://oauth.yandex.ru/token'
  const userInfoUrl = 'https://login.yandex.ru/info?format=json'
  const fetcher = config.fetcher ?? fetch
  const requestTimeoutMs = config.requestTimeoutMs ?? 5_000

  return {
    authorizationUrl({ codeChallenge, redirectUri, state }) {
      const url = new URL(authorizationBase)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      })

      const response = await providerFetch(fetcher, tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      }, 'Yandex token exchange')

      if (!response.ok) {
        throw new Error(`Yandex token exchange failed: ${response.status}`)
      }

      const data = tokenResponseSchema.parse(await response.json())

      if (data.error) {
        throw new Error('Yandex token exchange returned an error')
      }

      return {
        accessToken: data.access_token,
        // Yandex user id is not available at token exchange; fetch from user info
        providerSubject: '', // will be filled by getUserInfo
      }
    },

    async getUserInfo(accessToken) {
      const response = await providerFetch(fetcher, userInfoUrl, {
        headers: {
          Authorization: `OAuth ${accessToken}`,
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      }, 'Yandex user info')

      if (!response.ok) {
        throw new Error(`Yandex user info failed: ${response.status}`)
      }

      const data = userInfoResponseSchema.parse(await response.json())

      return {
        displayName: data.display_name ?? data.real_name ?? null,
        providerSubject: data.id,
      }
    },
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  error: z.string().optional(),
})

const userInfoResponseSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  real_name: z.string().optional(),
})

async function providerFetch(
  fetcher: NonNullable<YandexOAuthConfig['fetcher']>,
  input: string,
  init: RequestInit,
  operation: string,
) {
  try {
    return await fetcher(input, init)
  } catch {
    throw new Error(`${operation} failed before receiving a response`)
  }
}
