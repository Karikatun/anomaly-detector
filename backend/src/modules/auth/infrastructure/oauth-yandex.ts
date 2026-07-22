import type { OAuthProvider } from '../application/ports'

type YandexOAuthConfig = {
  clientId: string
  clientSecret: string
}

export function createYandexOAuthProvider(config: YandexOAuthConfig): OAuthProvider {
  const authorizationBase = 'https://oauth.yandex.ru/authorize'
  const tokenUrl = 'https://oauth.yandex.ru/token'
  const userInfoUrl = 'https://login.yandex.ru/info?format=json'

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

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Yandex token exchange failed: ${response.status} ${text}`)
      }

      const data = (await response.json()) as {
        access_token: string
        error?: string
      }

      if (data.error) {
        throw new Error(`Yandex token exchange error: ${data.error}`)
      }

      return {
        accessToken: data.access_token,
        // Yandex user id is not available at token exchange; fetch from user info
        providerSubject: '', // will be filled by getUserInfo
      }
    },

    async getUserInfo(accessToken) {
      const response = await fetch(userInfoUrl, {
        headers: {
          Authorization: `OAuth ${accessToken}`,
        },
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Yandex user info failed: ${response.status} ${text}`)
      }

      const data = (await response.json()) as {
        id: string
        display_name?: string
        real_name?: string
      }

      return {
        displayName: data.display_name ?? data.real_name ?? null,
        providerSubject: data.id,
      }
    },
  }
}
