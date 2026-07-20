export const oauthProviderIds = ['yandex', 'vk'] as const

export type OAuthProviderId = (typeof oauthProviderIds)[number]

export type OAuthTransaction = {
  codeVerifier: string
  expiresAt: Date
  provider: OAuthProviderId
  redirectUri: string
  state: string
}
