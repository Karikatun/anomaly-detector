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
  findUserById(userId: string): Promise<AuthUserRecord | null>
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
  completeOAuthSignIn(input: {
    accountEmail:
      | { kind: 'candidate'; canonicalKey: string; providerValue: string }
      | { kind: 'unavailable' }
    identity: { provider: OAuthProviderId; subject: string }
    newUser?: {
      displayName?: string | null
      legalAcceptance: {
        acceptedAt: Date
        privacyConsentVersion: string
        termsVersion: string
      }
      login: string
    }
    session: {
      refreshTokenHash: string
      refreshTokenFamilyHash: string
      expiresAt: Date
      metadata: SessionMetadata
    }
  }): Promise<{ user: AuthUserRecord; session: { id: string } } | null>
  readAccountProtection(userId: string): Promise<{
    accountEmailProviderValue: string | null
    accountEmailState: string
    recoveryEmailBinding?: {
      activatesAt: Date
      cancellationSessionIds: string[]
      providerValue: string
      requestedAt: Date
    } | null
    recoveryEmailChallenge?: {
      cancellationSessionIds: string[]
      expiresAt: Date
      providerValue: string
      requestedAt: Date
    } | null
    recoveryEmailReplacement?: {
      newCanonicalKey: string
      newConfirmedAt: Date | null
      newExpiresAt: Date
      newProviderValue: string
      oldConfirmedAt: Date | null
      oldExpiresAt: Date
      oldProviderValue: string
      requestingSessionId: string
    } | null
    hasYandexIdentity: boolean
  } | null>
  startRecoveryEmail(input: {
    canonicalKey: string
    expectedPasswordHash: string
    expiresAt: Date
    ipAddress?: string
    now: Date
    policyVersion: number
    providerValue: string
    sessionId: string
    userId: string
  }): Promise<void>
  resendRecoveryEmail(input: {
    expiresAt: Date
    ipAddress?: string
    now: Date
    userId: string
  }): Promise<void>
  confirmRecoveryEmail(input: {
    activatesAt: Date
    code: string
    now: Date
    userId: string
  }): Promise<'already_confirmed' | 'confirmed' | 'invalid'>
  cancelRecoveryEmail(input: {
    now: Date
    sessionId: string
    userId: string
  }): Promise<'cancelled' | 'forbidden' | 'unavailable'>
  startRecoveryEmailReplacement(input: {
    expectedPasswordHash: string
    expiresAt: Date
    ipAddress?: string
    newCanonicalKey: string
    newProviderValue: string
    now: Date
    sessionId: string
    userId: string
  }): Promise<void>
  resendRecoveryEmailReplacement(input: {
    expiresAt: Date
    factor: 'new' | 'old'
    ipAddress?: string
    now: Date
    sessionId: string
    userId: string
  }): Promise<void>
  confirmRecoveryEmailReplacement(input: {
    code: string
    factor: 'new' | 'old'
    now: Date
    sessionId: string
    userId: string
  }): Promise<'completed' | 'confirmed' | 'invalid'>
  cancelRecoveryEmailReplacement(input: {
    now: Date
    sessionId: string
    userId: string
  }): Promise<'cancelled' | 'forbidden' | 'unavailable'>
}

export type AccountEmailCanonicalizer = {
  canonicalize(value: string): Promise<{
    canonicalKey: string
    providerValue: string
  } | null>
  canonicalizeForRecovery?(value: string): Promise<{
    canonicalKey: string
    policyVersion: number
    providerValue: string
  } | null>
  evaluate?(emailDomain: string): Promise<{
    acceptsNewAddress: boolean
    allowsRecoveryDelivery: boolean
    state: 'approved' | 'blocked' | 'deprecated' | 'unlisted'
    version: number
  }>
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
    accountEmail?: string | null
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
