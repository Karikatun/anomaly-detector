import type { LoginRequest, RegisterPayload } from '@web-app-demo/contracts'

import { AuthFailure } from '../domain/errors'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthUserRecord, AuthenticatedPrincipal } from '../domain/user'
import { userDtoFromPrincipal } from '../domain/user'
import type {
  AccessTokens,
  AuthRepository,
  Clock,
  LogoutCleanup,
  Passwords,
  ProjectUser,
  RefreshTokens,
} from './ports'

type AuthServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  logoutCleanup: LogoutCleanup
  passwords: Passwords
  projectUser: ProjectUser
  refreshTokenTtlDays: number
  refreshReuseGraceSeconds: number
  sessionAbsoluteTtlDays: number
  refreshTokens: RefreshTokens
  repository: AuthRepository
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  async register(input: RegisterPayload, metadata: SessionMetadata) {
    const existingUser = await this.dependencies.repository.findUserByEmail(input.email)
    if (existingUser) {
      throw new AuthFailure('email_already_exists', 'User with this email already exists')
    }

    const passwordHash = await this.dependencies.passwords.hash(input.password)
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const { user, session } = await this.dependencies.repository.createPasswordUserWithSession({
      user: { ...input, passwordHash },
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: this.refreshExpiresAt(now),
        metadata,
      },
    })

    return this.sessionResponse(user, session.id, refreshToken)
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.dependencies.repository.findUserByEmail(input.email)
    if (
      !user?.passwordHash ||
      !(await this.dependencies.passwords.verify(input.password, user.passwordHash))
    ) {
      throw new AuthFailure('invalid_credentials', 'Invalid email or password')
    }

    return this.issueSession(user, metadata)
  }

  async refresh(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new AuthFailure('refresh_token_required', 'Refresh token is required')
    }

    const now = this.dependencies.clock.now()
    const presentedRefreshTokenHash = this.dependencies.refreshTokens.hash(refreshToken)
    const refreshLookup = {
      refreshTokenHash: presentedRefreshTokenHash,
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      now,
      createdAfter: this.sessionAbsoluteNotBefore(now),
      reuseGraceAfter: new Date(
        now.getTime() - this.dependencies.refreshReuseGraceSeconds * 1000,
      ),
    }
    let currentSession = await this.dependencies.repository.findActiveRefreshSession(refreshLookup)
    if (!currentSession) {
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    if (currentSession.credentialState === 'reused') {
      await this.dependencies.repository.revokeSessionById({
        sessionId: currentSession.id,
        now,
      })
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    const nextRefreshToken = this.dependencies.refreshTokens.rotate(refreshToken)
    const nextRefreshTokenHash = this.dependencies.refreshTokens.hash(nextRefreshToken)
    const nextRefreshTokenFamilyHash = this.dependencies.refreshTokens.familyHash(nextRefreshToken)
    if (currentSession.credentialState === 'previous_within_grace') {
      if (currentSession.refreshTokenHash !== nextRefreshTokenHash) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      return this.refreshResponse(currentSession, nextRefreshToken)
    }

    const rotated = await this.dependencies.repository.rotateRefreshSession({
      currentSessionId: currentSession.id,
      currentRefreshTokenHash: currentSession.refreshTokenHash,
      now,
      nextRefreshTokenHash,
      nextRefreshTokenFamilyHash,
      nextExpiresAt: this.refreshExpiresAt(now),
      metadata,
    })
    if (!rotated) {
      const racedSession = await this.dependencies.repository.findActiveRefreshSession(refreshLookup)
      if (!racedSession || racedSession.id !== currentSession.id) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      if (racedSession.credentialState === 'reused') {
        await this.dependencies.repository.revokeSessionById({
          sessionId: racedSession.id,
          now,
        })
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      if (
        racedSession.credentialState !== 'previous_within_grace' ||
        racedSession.refreshTokenHash !== nextRefreshTokenHash
      ) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }

      return this.refreshResponse(racedSession, nextRefreshToken)
    }

    return this.refreshResponse(currentSession, nextRefreshToken)
  }

  private async refreshResponse(
    session: { id: string; user: AuthUserRecord },
    refreshToken: string,
  ) {
    return {
      accessToken: await this.dependencies.accessTokens.sign({
        sub: session.user.id,
        email: session.user.email,
        sessionId: session.id,
      }),
      refreshToken,
    }
  }

  async authenticateAccessToken(accessToken: string | undefined): Promise<AuthenticatedPrincipal> {
    if (!accessToken) {
      throw new AuthFailure('access_token_required', 'Access token is required')
    }

    let payload
    try {
      payload = await this.dependencies.accessTokens.verify(accessToken)
    } catch {
      throw new AuthFailure('access_token_invalid', 'Access token is invalid or expired')
    }

    const now = this.dependencies.clock.now()
    const session = await this.dependencies.repository.findActiveAccessSession({
      sessionId: payload.sessionId,
      userId: payload.sub,
      now,
      createdAfter: this.sessionAbsoluteNotBefore(now),
    })
    if (!session) {
      throw new AuthFailure('session_invalid', 'Session is invalid or expired')
    }

    return {
      ...(await this.dependencies.projectUser(session.user)),
      sessionId: session.id,
    }
  }

  async getMe(accessToken: string | undefined) {
    return { user: userDtoFromPrincipal(await this.authenticateAccessToken(accessToken)) }
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return false

    const userId = await this.dependencies.repository.revokeSession({
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      now: this.dependencies.clock.now(),
    })
    if (!userId) return false

    await this.dependencies.logoutCleanup({ userId })
    return true
  }

  private async issueSession(user: AuthUserRecord, metadata: SessionMetadata) {
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const session = await this.dependencies.repository.createSession({
      userId: user.id,
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      expiresAt: this.refreshExpiresAt(now),
      metadata,
    })

    return this.sessionResponse(user, session.id, refreshToken)
  }

  private async sessionResponse(user: AuthUserRecord, sessionId: string, refreshToken: string) {
    return {
      user: await this.dependencies.projectUser(user),
      accessToken: await this.dependencies.accessTokens.sign({
        sub: user.id,
        email: user.email,
        sessionId,
      }),
      refreshToken,
    }
  }

  private refreshExpiresAt(now: Date) {
    return sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays)
  }

  private sessionAbsoluteNotBefore(now: Date) {
    return new Date(now.getTime() - this.dependencies.sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000)
  }
}
