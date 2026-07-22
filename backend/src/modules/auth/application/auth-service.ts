import type { LoginRequest, RegisterPayload } from '@anomaly-detector/contracts'

import { AuthFailure } from '../domain/errors'
import type { OAuthProviderId } from '../domain/oauth'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthUserRecord, AuthenticatedPrincipal } from '../domain/user'
import { userDtoFromPrincipal } from '../domain/user'
import type {
  AccessTokens,
  AuthRepository,
  Clock,
  LogoutCleanup,
  OAuthProviderRegistry,
  Passwords,
  ProjectUser,
  RefreshTokens,
} from './ports'

type AuthServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  logoutCleanup: LogoutCleanup
  oauthProviders?: OAuthProviderRegistry
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
    const existingUser = await this.dependencies.repository.findUserByLogin(input.login)
    if (existingUser) {
      throw new AuthFailure('login_already_exists', 'User with this login already exists')
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

  async startOAuthSignIn(input: { provider: OAuthProviderId; redirectUri: string; webappOrigin: string }) {
    const { codeChallenge, codeVerifier } = await createPkcePair()
    const state = `${encodeWebappOrigin(input.webappOrigin)}::${crypto.randomUUID()}${crypto.randomUUID()}`
    const oauthProviders = this.dependencies.oauthProviders
    if (!oauthProviders) {
      throw new AuthFailure('oauth_not_configured', 'OAuth sign-in is not configured')
    }
    const provider = oauthProviders.require(input.provider)
    await this.dependencies.repository.createOAuthTransaction({
      codeVerifier,
      expiresAt: new Date(this.dependencies.clock.now().getTime() + 10 * 60 * 1000),
      provider: input.provider,
      redirectUri: input.redirectUri,
      state,
    })
    return {
      authorizationUrl: provider.authorizationUrl({
        codeChallenge,
        redirectUri: input.redirectUri,
        state,
      }),
    }
  }

  async completeOAuthSignIn(input: {
    code: string
    state: string
    metadata: SessionMetadata
  }) {
    const oauthProviders = this.dependencies.oauthProviders
    if (!oauthProviders) {
      throw new AuthFailure('oauth_not_configured', 'OAuth sign-in is not configured')
    }

    const transaction = await this.dependencies.repository.findOAuthTransactionByState({
      state: input.state,
    })
    if (!transaction) {
      throw new AuthFailure('oauth_transaction_invalid', 'OAuth transaction is invalid or expired')
    }

    const provider = oauthProviders.require(transaction.provider)
    const tokenResult = await provider.exchangeCode({
      code: input.code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: transaction.redirectUri,
    })

    const userInfo = await provider.getUserInfo(tokenResult.accessToken)
    const providerSubject = userInfo.providerSubject || tokenResult.providerSubject

    // Store the user identity
    let existingUser = await this.dependencies.repository.findUserByIdentity({
      provider: transaction.provider,
      subject: providerSubject,
    })

    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()

    let session: { id: string }
    let user: import('../domain/user').AuthUserRecord

    if (existingUser) {
      user = existingUser
      const createdSession = await this.dependencies.repository.createSession({
        userId: existingUser.id,
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: this.refreshExpiresAt(now),
        metadata: input.metadata,
      })
      session = createdSession
    } else {
      const created = await this.dependencies.repository.createOAuthUserWithSession({
        user: {
          login: oauthLogin(transaction.provider),
          displayName: userInfo.displayName ?? null,
        },
        identity: {
          provider: transaction.provider,
          subject: providerSubject,
        },
        session: {
          refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
          refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
          expiresAt: this.refreshExpiresAt(now),
          metadata: input.metadata,
        },
      })
      user = created.user
      session = created.session
    }

    // Clean up the used transaction
    const webappOrigin = decodeWebappOrigin(input.state) ?? ''
    await this.dependencies.repository.deleteOAuthTransaction({ state: input.state }).catch(() => undefined)

    const response = await this.sessionResponse(user, session.id, refreshToken)
    return { ...response, webappOrigin }
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.dependencies.repository.findUserByLogin(input.login)
    if (
      !user?.passwordHash ||
      !(await this.dependencies.passwords.verify(input.password, user.passwordHash))
    ) {
      throw new AuthFailure('invalid_credentials', 'Invalid login or password')
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
        login: session.user.login,
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

  async deleteAccount(userId: string) {
    const now = this.dependencies.clock.now()
    await this.dependencies.repository.revokeAllSessionsByUserId({ userId, now })
    await this.dependencies.repository.anonymizeUser({ userId, now })
  }

  async updateProfile(userId: string, input: { displayName?: string | null; locale?: 'ru' | 'en' }) {
    await this.dependencies.repository.updateUser({
      userId,
      displayName: input.displayName === '' ? null : input.displayName,
      locale: input.locale,
    })
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
        login: user.login,
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

async function createPkcePair() {
  const codeVerifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return { codeChallenge, codeVerifier }
}

function encodeWebappOrigin(origin: string) {
  return Buffer.from(origin).toString('base64url')
}

function decodeWebappOrigin(state: string) {
  const parts = state.split('::')
  if (parts.length < 2) return null
  try {
    return Buffer.from(parts[0], 'base64url').toString('utf-8')
  } catch {
    return null
  }
}

function oauthLogin(provider: OAuthProviderId) {
  return `oauth-${provider}-${crypto.randomUUID().replaceAll('-', '')}`
}
