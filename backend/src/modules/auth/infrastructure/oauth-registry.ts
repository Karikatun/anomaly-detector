import type { OAuthProvider, OAuthProviderRegistry as OAuthProviderRegistryType } from '../application/ports'
import type { OAuthProviderId } from '../domain/oauth'

export class OAuthProviderRegistry implements OAuthProviderRegistryType {
  private readonly providers = new Map<OAuthProviderId, OAuthProvider>()

  register(providerId: OAuthProviderId, provider: OAuthProvider): void {
    this.providers.set(providerId, provider)
  }

  hasAny(): boolean {
    return this.providers.size > 0
  }

  require(provider: OAuthProviderId): OAuthProvider {
    const instance = this.providers.get(provider)
    if (!instance) {
      throw new Error(`OAuth provider '${provider}' is not configured`)
    }
    return instance
  }
}