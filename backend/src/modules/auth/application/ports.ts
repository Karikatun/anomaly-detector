import type { RegisterPayload, UserDto } from '@web-app-demo/contracts'

import type { SessionMetadata } from '../domain/session'
import type { AuthUserRecord } from '../domain/user'

export type AccessTokenPayload = {
  sub: string
  sessionId: string
  email: string
}

export type AuthRepository = {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>
  createPasswordUserWithSession(input: {
    user: RegisterPayload & { passwordHash: string }
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
  }): Promise<{ id: string; user: AuthUserRecord } | null>
  revokeSession(input: {
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    now: Date
  }): Promise<string | null>
}

export type AccessTokens = {
  sign(payload: AccessTokenPayload): Promise<string>
  verify(token: string): Promise<AccessTokenPayload>
}

export type Passwords = {
  hash(password: string): Promise<string>
  verify(password: string, passwordHash: string): Promise<boolean>
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
