import {
  displayNameMaxLength,
  type AccountProtectionResponse,
  type LoginRequest,
  type RegisterPayload,
} from '@anomaly-detector/contracts'

import { AuthFailure } from '../domain/errors'
import type { OAuthProviderId } from '../domain/oauth'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthUserRecord, AuthenticatedPrincipal } from '../domain/user'
import { userDtoFromPrincipal } from '../domain/user'
import type {
  AccountDeletionCleanup,
  AccountEmailCanonicalizer,
  AccessTokens,
  AuthAbuseProtection,
  AuthRepository,
  Clock,
  LogoutCleanup,
  OAuthProviderRegistry,
  Passwords,
  ProjectUser,
  RefreshTokens,
} from './ports'

type AuthServiceDependencies = {
  accountDeletionCleanup?: AccountDeletionCleanup
  accountEmailCanonicalizer?: AccountEmailCanonicalizer
  accessTokens: AccessTokens
  abuseProtection?: AuthAbuseProtection
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

const ACCOUNT_DELETION_RECENT_AUTH_MS = 10 * 60 * 1_000
const AUTHENTICATION_CLOCK_SKEW_MS = 60 * 1_000
const RECOVERY_EMAIL_CODE_TTL_MS = 15 * 60 * 1_000
const RECOVERY_EMAIL_COOLING_OFF_MS = 24 * 60 * 60 * 1_000

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  async register(
    input: RegisterPayload,
    metadata: SessionMetadata,
    registration?: { deviceId?: string },
  ) {
    const existingUser = await this.dependencies.repository.findUserByLogin(input.login)
    if (existingUser) {
      throw new AuthFailure('login_already_exists', 'User with this login already exists')
    }

    const passwordHash = await this.dependencies.passwords.hash(input.password)
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const { user, session } = await this.dependencies.repository.createPasswordUserWithSession({
      ...(registration ? {
        registration: {
          ...(registration.deviceId ? { deviceId: registration.deviceId } : {}),
          ipAddress: metadata.ipAddress,
          now,
        },
      } : {}),
      user: { ...input, legalAcceptedAt: now, passwordHash },
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: this.refreshExpiresAt(now),
        metadata,
      },
    })

    return this.sessionResponse(user, session.id, refreshToken)
  }

  async startOAuthSignIn(input: {
    provider: OAuthProviderId
    redirectUri: string
    registration?: {
      privacyConsent: true
      privacyConsentVersion: string
      termsAccepted: true
      termsVersion: string
    }
    webappOrigin: string
  }) {
    const { codeChallenge, codeVerifier } = await createPkcePair()
    const state = `${encodeWebappOrigin(input.webappOrigin)}::${crypto.randomUUID()}${crypto.randomUUID()}`
    const now = this.dependencies.clock.now()
    const oauthProviders = this.dependencies.oauthProviders
    if (!oauthProviders) {
      throw new AuthFailure('oauth_not_configured', 'OAuth sign-in is not configured')
    }
    const provider = oauthProviders.require(input.provider)
    await this.dependencies.repository.createOAuthTransaction({
      codeVerifier,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      ...(input.registration ? {
        legalAcceptance: {
          acceptedAt: now,
          privacyConsentVersion: input.registration.privacyConsentVersion,
          termsVersion: input.registration.termsVersion,
        },
      } : {}),
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

    const transaction = await this.dependencies.repository.consumeOAuthTransactionByState({
      now: this.dependencies.clock.now(),
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

    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const accountEmail = await this.canonicalizeProviderAccountEmail(userInfo.accountEmail)
    const completed = await this.dependencies.repository.completeOAuthSignIn({
      accountEmail: accountEmail
        ? { kind: 'candidate', ...accountEmail }
        : { kind: 'unavailable' },
      identity: {
        provider: transaction.provider,
        subject: providerSubject,
      },
      ...(transaction.legalAcceptance ? {
        newUser: {
          login: oauthLogin(transaction.provider),
          displayName: normalizeProviderDisplayName(userInfo.displayName),
          legalAcceptance: transaction.legalAcceptance,
        },
      } : {}),
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: this.refreshExpiresAt(now),
        metadata: input.metadata,
      },
    })
    if (!completed) {
      throw new AuthFailure(
        'oauth_registration_consent_required',
        'Legal acceptance is required to create an account',
      )
    }

    const webappOrigin = decodeWebappOrigin(input.state) ?? ''

    const response = await this.sessionResponse(completed.user, completed.session.id, refreshToken)
    return { ...response, webappOrigin }
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const now = this.dependencies.clock.now()
    await this.dependencies.abuseProtection?.beginLoginAttempt({
      ipAddress: metadata.ipAddress,
      login: input.login,
      now,
    })
    const user = await this.dependencies.repository.findUserByLogin(input.login)
    const passwordMatches = await this.dependencies.passwords.verify(
      input.password,
      user?.passwordHash,
    )
    if (!user?.passwordHash || !passwordMatches) {
      const failure = await this.dependencies.abuseProtection?.recordLoginFailure({
        login: input.login,
        now,
      })
      if (failure?.limited) {
        throw new AuthFailure('login_throttled', 'Invalid login or password. Try again later.')
      }
      throw new AuthFailure('invalid_credentials', 'Invalid login or password')
    }

    if (this.dependencies.passwords.needsRehash(user.passwordHash)) {
      const nextPasswordHash = await this.dependencies.passwords.hash(input.password)
      await this.dependencies.repository.updatePasswordHash({
        userId: user.id,
        currentPasswordHash: user.passwordHash,
        nextPasswordHash,
      })
    }

    await this.dependencies.abuseProtection?.recordLoginSuccess({ login: input.login })
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
      throw new AuthFailure('refresh_token_reused', 'Refresh session is invalid or expired')
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
        throw new AuthFailure('refresh_token_reused', 'Refresh session is invalid or expired')
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
      authenticatedAt: session.createdAt,
      sessionId: session.id,
    }
  }

  async getMe(accessToken: string | undefined) {
    return { user: userDtoFromPrincipal(await this.authenticateAccessToken(accessToken)) }
  }

  async getAccountProtection(
    userId: string,
    sessionId?: string,
  ): Promise<AccountProtectionResponse> {
    const record = await this.dependencies.repository.readAccountProtection(userId)
    if (!record) {
      throw new AuthFailure('session_invalid', 'Session is invalid or expired')
    }
    if (
      record.hasYandexIdentity
      &&
      record.accountEmailState === 'yandex_managed'
      && record.accountEmailProviderValue
    ) {
      return {
        accountProtection: {
          maskedAccountEmail: maskAccountEmail(record.accountEmailProviderValue),
          state: 'yandex_managed',
        },
      }
    }
    if (record.hasYandexIdentity && record.accountEmailState === 'yandex_conflict') {
      return { accountProtection: { state: 'yandex_conflict' } }
    }
    if (record.hasYandexIdentity) {
      return { accountProtection: { state: 'yandex_unavailable' } }
    }

    const challenge = record.recoveryEmailChallenge
    if (challenge) {
      const canCancel = sessionId !== undefined
        && challenge.cancellationSessionIds.includes(sessionId)
      if (!await this.recoveryDeliveryAllowed(challenge.providerValue)) {
        return {
          accountProtection: {
            blockedStage: 'pending_code',
            canCancel,
            maskedAccountEmail: maskAccountEmail(challenge.providerValue),
            state: 'password_service_blocked',
          },
        }
      }
      return {
        accountProtection: {
          canCancel,
          codeExpiresAt: challenge.expiresAt.toISOString(),
          maskedAccountEmail: maskAccountEmail(challenge.providerValue),
          state: 'password_pending_code',
        },
      }
    }

    const binding = record.recoveryEmailBinding
    if (!binding) return { accountProtection: { state: 'password_unprotected' } }

    const coolingOff = binding.activatesAt > this.dependencies.clock.now()
    const canCancel = coolingOff
      && sessionId !== undefined
      && binding.cancellationSessionIds.includes(sessionId)
    if (!await this.recoveryDeliveryAllowed(binding.providerValue)) {
      return {
        accountProtection: {
          blockedStage: coolingOff ? 'cooling_off' : 'active',
          canCancel,
          maskedAccountEmail: maskAccountEmail(binding.providerValue),
          state: 'password_service_blocked',
        },
      }
    }
    if (coolingOff) {
      return {
        accountProtection: {
          activatesAt: binding.activatesAt.toISOString(),
          canCancel,
          maskedAccountEmail: maskAccountEmail(binding.providerValue),
          state: 'password_cooling_off',
        },
      }
    }
    return {
      accountProtection: {
        maskedAccountEmail: maskAccountEmail(binding.providerValue),
        state: 'password_active',
      },
    }
  }

  async startRecoveryEmail(input: {
    email: string
    ipAddress?: string
    password: string
    sessionId: string
    userId: string
  }): Promise<AccountProtectionResponse> {
    const user = await this.dependencies.repository.findUserById(input.userId)
    if (!user?.passwordHash) {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    if (!await this.dependencies.passwords.verify(input.password, user.passwordHash)) {
      throw new AuthFailure('recovery_password_invalid', 'Current password is invalid')
    }

    const candidate = await this.dependencies.accountEmailCanonicalizer
      ?.canonicalizeForRecovery?.(input.email)
    if (!candidate) {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    const now = this.dependencies.clock.now()
    await this.dependencies.repository.startRecoveryEmail({
      canonicalKey: candidate.canonicalKey,
      expectedPasswordHash: user.passwordHash,
      expiresAt: new Date(now.getTime() + RECOVERY_EMAIL_CODE_TTL_MS),
      ipAddress: input.ipAddress,
      now,
      policyVersion: candidate.policyVersion,
      providerValue: candidate.providerValue,
      sessionId: input.sessionId,
      userId: input.userId,
    })
    return this.getAccountProtection(input.userId, input.sessionId)
  }

  async resendRecoveryEmail(input: {
    ipAddress?: string
    sessionId: string
    userId: string
  }): Promise<AccountProtectionResponse> {
    const record = await this.dependencies.repository.readAccountProtection(input.userId)
    const challenge = record?.recoveryEmailChallenge
    if (!record || record.hasYandexIdentity || !challenge) {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    if (!await this.recoveryDeliveryAllowed(challenge.providerValue)) {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    const now = this.dependencies.clock.now()
    await this.dependencies.repository.resendRecoveryEmail({
      expiresAt: new Date(now.getTime() + RECOVERY_EMAIL_CODE_TTL_MS),
      ipAddress: input.ipAddress,
      now,
      userId: input.userId,
    })
    return this.getAccountProtection(input.userId, input.sessionId)
  }

  async confirmRecoveryEmail(input: {
    code: string
    sessionId: string
    userId: string
  }): Promise<AccountProtectionResponse> {
    const record = await this.dependencies.repository.readAccountProtection(input.userId)
    const challenge = record?.recoveryEmailChallenge
    if (challenge && !await this.recoveryDeliveryAllowed(challenge.providerValue)) {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    const now = this.dependencies.clock.now()
    const result = await this.dependencies.repository.confirmRecoveryEmail({
      activatesAt: new Date(now.getTime() + RECOVERY_EMAIL_COOLING_OFF_MS),
      code: input.code,
      now,
      userId: input.userId,
    })
    if (result === 'invalid') {
      throw new AuthFailure(
        'recovery_code_invalid',
        'Confirmation code is invalid or expired',
      )
    }
    return this.getAccountProtection(input.userId, input.sessionId)
  }

  async cancelRecoveryEmail(input: {
    sessionId: string
    userId: string
  }): Promise<AccountProtectionResponse> {
    const result = await this.dependencies.repository.cancelRecoveryEmail({
      now: this.dependencies.clock.now(),
      sessionId: input.sessionId,
      userId: input.userId,
    })
    if (result === 'forbidden') {
      throw new AuthFailure(
        'recovery_cancellation_forbidden',
        'This session cannot cancel Recovery Email protection',
      )
    }
    if (result === 'unavailable') {
      throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
    }
    return this.getAccountProtection(input.userId, input.sessionId)
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

  async deleteAccount(input: { authenticatedAt: Date; userId: string }) {
    const now = this.dependencies.clock.now()
    const authenticationAge = now.getTime() - input.authenticatedAt.getTime()
    if (
      authenticationAge > ACCOUNT_DELETION_RECENT_AUTH_MS
      || authenticationAge < -AUTHENTICATION_CLOCK_SKEW_MS
    ) {
      throw new AuthFailure(
        'recent_authentication_required',
        'Recent authentication is required to delete the account',
      )
    }
    await this.dependencies.accountDeletionCleanup?.({ userId: input.userId })
    await this.dependencies.repository.eraseUserIdentity({ userId: input.userId, now })
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

  private async canonicalizeProviderAccountEmail(value: string | null | undefined) {
    if (!value || !this.dependencies.accountEmailCanonicalizer) return null
    try {
      return await this.dependencies.accountEmailCanonicalizer.canonicalize(value)
    } catch {
      return null
    }
  }

  private async recoveryDeliveryAllowed(providerValue: string) {
    const evaluate = this.dependencies.accountEmailCanonicalizer?.evaluate
    if (!evaluate) return false
    const separator = providerValue.lastIndexOf('@')
    if (separator <= 0) return false
    return (await evaluate(providerValue.slice(separator + 1))).allowsRecoveryDelivery
  }

  private refreshExpiresAt(now: Date) {
    return sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays)
  }

  private sessionAbsoluteNotBefore(now: Date) {
    return new Date(now.getTime() - this.dependencies.sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000)
  }
}

function normalizeProviderDisplayName(displayName: string | null | undefined): string | null {
  const normalized = displayName?.trim()
  if (!normalized) return null
  return normalized.slice(0, displayNameMaxLength).trimEnd()
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

function maskAccountEmail(value: string) {
  const separator = value.lastIndexOf('@')
  const localPart = value.slice(0, separator)
  const domain = value.slice(separator + 1)
  return `${Array.from(localPart)[0] ?? '*'}***@${domain}`
}
