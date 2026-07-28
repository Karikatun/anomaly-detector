import type { RegisterPayload, UserDto } from '@anomaly-detector/contracts'

import type { SessionMetadata } from '../domain/session'
import type { OAuthProviderId, OAuthTransaction } from '../domain/oauth'
import type { AuthUserRecord } from '../domain/user'

export type AccessTokenPayload = {
  sub: string
  sessionId: string
  login: string
}

export type AuthRepository = {
  findUserByLogin(login: string): Promise<AuthUserRecord | null>
  updatePasswordHash(input: {
    userId: string
    currentPasswordHash: string
    nextPasswordHash: string
  }): Promise<void>
  createPasswordUserWithSession(input: {
    registration?: {
      deviceId?: string
      ipAddress?: string
      now: Date
    }
    user: RegisterPayload & { legalAcceptedAt: Date; passwordHash: string }
    session: {
      refreshTokenHash: string
      refreshTokenFamilyHash: string
      expiresAt: Date
      metadata: SessionMetadata
    }
  }): Promise<{ user: AuthUserRecord; session: { id: string } }>
  createSession(input: {
    userId: string
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    expiresAt: Date
    metadata: SessionMetadata
  }): Promise<{ id: string }>
  findActiveRefreshSession(input: {
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    now: Date
    createdAfter: Date
    reuseGraceAfter: Date
  }): Promise<{
    id: string
    userId: string
    user: AuthUserRecord
    refreshTokenHash: string
    credentialState: 'current' | 'previous_within_grace' | 'reused'
  } | null>
  rotateRefreshSession(input: {
    currentSessionId: string
    currentRefreshTokenHash: string
    now: Date
    nextRefreshTokenHash: string
    nextRefreshTokenFamilyHash: string
    nextExpiresAt: Date
    metadata: SessionMetadata
  }): Promise<boolean>
  revokeSessionById(input: { sessionId: string; now: Date }): Promise<boolean>
  findActiveAccessSession(input: {
    sessionId: string
    userId: string
    now: Date
    createdAfter: Date
  }): Promise<{ createdAt: Date; id: string; user: AuthUserRecord } | null>
  revokeSession(input: {
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    now: Date
  }): Promise<string | null>
  updateUser(input: {
    userId: string
    displayName?: string | null
    locale?: string
  }): Promise<void>
  eraseUserIdentity(input: { userId: string; now: Date }): Promise<void>
  createOAuthTransaction(transaction: OAuthTransaction): Promise<void>
  consumeOAuthTransactionByState(input: {
    now: Date
    state: string
  }): Promise<OAuthTransaction | null>
  findUserByIdentity(input: { provider: string; subject: string }): Promise<AuthUserRecord | null>
  createOAuthUserWithSession(input: {
    user: {
      displayName?: string | null
      legalAcceptance: {
        acceptedAt: Date
        privacyConsentVersion: string
        termsVersion: string
      }
      login: string
    }
    identity: { provider: string; subject: string }
    session: {
      refreshTokenHash: string
      refreshTokenFamilyHash: string
      expiresAt: Date
      metadata: SessionMetadata
    }
  }): Promise<{ user: AuthUserRecord; session: { id: string } }>
}

export type OAuthProvider = {
  authorizationUrl(input: {
    codeChallenge: string
    redirectUri: string
    state: string
  }): string
  exchangeCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{
    accessToken: string
    providerSubject: string
  }>
  getUserInfo(accessToken: string): Promise<{
    displayName?: string | null
    providerSubject: string
  }>
}

export type OAuthProviderRegistry = {
  require(provider: OAuthProviderId): OAuthProvider
}

export type AccessTokens = {
  sign(payload: AccessTokenPayload): Promise<string>
  verify(token: string): Promise<AccessTokenPayload>
}

export type Passwords = {
  hash(password: string): Promise<string>
  needsRehash(passwordHash: string): boolean
  verify(password: string, passwordHash: string | null | undefined): Promise<boolean>
}

export type AuthAbuseProtection = {
  beginLoginAttempt(input: { ipAddress?: string; login: string; now: Date }): Promise<void>
  recordLoginFailure(input: { login: string; now: Date }): Promise<{ limited: boolean }>
  recordLoginSuccess(input: { login: string }): Promise<void>
}

export type DeviceTokens = {
  resolve(value: string | undefined): {
    deviceId: string
    cookieValue: string | null
  }
}

export type RefreshTokens = {
  create(): string
  hash(token: string): string
  familyHash(token: string): string
  rotate(token: string): string
}

export type Clock = {
  now(): Date
}

export type ProjectUser = (user: AuthUserRecord) => UserDto | Promise<UserDto>
export type LogoutCleanup = (input: { userId: string }) => void | Promise<void>
export type AccountDeletionCleanup = (input: { userId: string }) => void | Promise<void>
