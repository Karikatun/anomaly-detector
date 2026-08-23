import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AuthService } from './application/auth-service'
import type {
  AccountDeletionCleanup,
  AccountEmailCanonicalizer,
  Clock,
  LogoutCleanup,
  ProjectUser,
} from './application/ports'
import { toBaseUserDto } from './domain/user'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import {
  hashPassword,
  passwordHashNeedsRehash,
  verifyPassword,
} from './infrastructure/passwords'
import {
  createRefreshToken,
  deriveRotatedRefreshToken,
  hashRefreshToken,
  hashRefreshTokenFamily,
} from './infrastructure/refresh-tokens'
import { createRequireAuth, type AuthHttpEnv } from './transport/middleware'
import { createAuthRoutes } from './transport/routes'
import { OAuthProviderRegistry } from './infrastructure/oauth-registry'
import { createYandexOAuthProvider } from './infrastructure/oauth-yandex'
import { createPrismaAuthAbuseProtection } from './infrastructure/auth-abuse-protection'
import { cleanupExpiredAuthRecovery } from './infrastructure/prisma-auth-recovery-cleanup'
import { createDeviceTokens } from './infrastructure/device-token'
import { createPrismaRequestBudget } from '../../security/request-budget'
import { createAuthenticatedMutationBudget } from './transport/authenticated-mutation-budget'

type CreateAuthModuleOptions = {
  accountEmailCanonicalizer?: AccountEmailCanonicalizer
  clock?: Clock
  accountDeletionCleanup?: AccountDeletionCleanup
  db: DbClient
  env: AppEnv
  logoutCleanup?: LogoutCleanup
  projectUser?: ProjectUser
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined
const noAccountDeletionCleanup: AccountDeletionCleanup = () => undefined

export function createAuthModule({
  accountEmailCanonicalizer,
  clock = systemClock,
  accountDeletionCleanup = noAccountDeletionCleanup,
  db,
  env,
  logoutCleanup = noLogoutCleanup,
  projectUser = toBaseUserDto,
}: CreateAuthModuleOptions) {
  // Build OAuth provider registry
  const oauthProviders = new OAuthProviderRegistry()

  if (env.YANDEX_OAUTH_CLIENT_ID && env.YANDEX_OAUTH_CLIENT_SECRET) {
    oauthProviders.register('yandex', createYandexOAuthProvider({
      clientId: env.YANDEX_OAUTH_CLIENT_ID,
      clientSecret: env.YANDEX_OAUTH_CLIENT_SECRET,
    }))
  }

  const service = new AuthService({
    accountDeletionCleanup,
    accountEmailCanonicalizer,
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    abuseProtection: createPrismaAuthAbuseProtection(db, env.JWT_SECRET),
    clock,
    logoutCleanup,
    oauthProviders: oauthProviders.hasAny() ? oauthProviders : undefined,
    passwords: {
      hash: hashPassword,
      needsRehash: passwordHashNeedsRehash,
      verify: verifyPassword,
    },
    passwordResetUrl: new URL('/recover/password', env.WEBAPP_ORIGIN).toString(),
    projectUser,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: createRefreshToken,
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    repository: createPrismaAuthRepository(db, env.JWT_SECRET),
  })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))
  const authenticatedMutationBudget = createAuthenticatedMutationBudget(
    createPrismaRequestBudget(db),
  )

  return {
    authenticatedMutationBudget,
    authenticateAccessToken: (accessToken: string | undefined) =>
      service.authenticateAccessToken(accessToken),
    requireAuth,
    routes: createAuthRoutes({
      deviceTokens: createDeviceTokens(env.JWT_SECRET),
      env,
      oauthCallbackBaseUrl: env.OAUTH_CALLBACK_BASE_URL,
      authenticatedMutationBudget,
      requireAuth,
      service,
      webappUrl: env.WEBAPP_ORIGIN,
    }),
  }
}

export type { AuthHttpEnv }
export { cleanupExpiredAuthRecovery }
export type { LogoutCleanup, ProjectUser } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
