import type { OAuthProvider } from '../application/ports'

type VkOAuthConfig = {
  clientId: string
  clientSecret: string
}

export function createVkOAuthProvider(config: VkOAuthConfig): OAuthProvider {
  const authorizationBase = 'https://id.vk.com/authorize'
  const tokenUrl = 'https://id.vk.com/oauth2/token'
  const userInfoUrl = 'https://id.vk.com/oauth2/user_info'

  return {
    authorizationUrl({ codeChallenge, redirectUri, state }) {
      const url = new URL(authorizationBase)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', state)
      url.searchParams.set('scope', 'email')
      return url.toString()
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        // VK ID requires client_secret as a separate param
        client_secret: config.clientSecret,
      })

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`VK token exchange failed: ${response.status} ${text}`)
      }

      const data = (await response.json()) as {
        access_token: string
        user_id?: number
        error?: string
        error_description?: string
      }

      if (data.error) {
        throw new Error(`VK token exchange error: ${data.error}: ${data.error_description ?? ''}`)
      }

      return {
        accessToken: data.access_token,
        providerSubject: data.user_id?.toString() ?? '',
      }
    },

    async getUserInfo(accessToken) {
      const response = await fetch(userInfoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          access_token: accessToken,
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`VK user info failed: ${response.status} ${text}`)
      }

      const data = (await response.json()) as {
        user?: {
          user_id: string
          email?: string
          name?: string
          phone?: string
        }
        email?: string
        name?: string
        error?: string
      }

      if (data.error) {
        throw new Error(`VK user info error: ${data.error}`)
      }

      const userInfo = 'user' in data && data.user ? data.user : data as { user_id?: string; email?: string; name?: string }
      return {
        email: userInfo.email ?? `${userInfo.user_id ?? 'unknown'}@vk.id`,
        displayName: userInfo.name ?? null,
        providerSubject: userInfo.user_id?.toString() ?? '',
      }
    },
  }
}
