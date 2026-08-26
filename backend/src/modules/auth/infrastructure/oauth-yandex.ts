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
      url.searchParams.set('scope', 'login:email')
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

      const data = await parseProviderJson(
        response,
        tokenResponseSchema,
        'Yandex token exchange returned an invalid response',
      )

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

      const data = await parseProviderJson(
        response,
        userInfoResponseSchema,
        'Yandex user info returned an invalid response',
      )

      return {
        accountEmail: data.default_email ?? null,
        displayName: data.display_name ?? data.real_name ?? null,
        providerSubject: data.id,
      }
    },
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4_096),
  error: z.string().max(128).optional(),
})

const userInfoResponseSchema = z.object({
  id: z.string().min(1).max(256),
  display_name: z.string().max(512).optional(),
  real_name: z.string().max(512).optional(),
  default_email: z.string().min(3).max(320).optional(),
})

const providerResponseMaxBytes = 16 * 1_024

async function parseProviderJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  invalidResponseMessage: string,
): Promise<T> {
  try {
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > providerResponseMaxBytes) {
      throw new Error('response too large')
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('response body missing')
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > providerResponseMaxBytes) {
        await reader.cancel()
        throw new Error('response too large')
      }
      chunks.push(value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)))
  } catch {
    throw new Error(invalidResponseMessage)
  }
}

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
