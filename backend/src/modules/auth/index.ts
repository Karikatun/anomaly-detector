import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AuthService } from './application/auth-service'
import type { Clock, LogoutCleanup, ProjectUser } from './application/ports'
import { toBaseUserDto } from './domain/user'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import { hashPassword, verifyPassword } from './infrastructure/passwords'
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
import { createVkOAuthProvider } from './infrastructure/oauth-vk'

type CreateAuthModuleOptions = {
  clock?: Clock
  db: DbClient
  env: AppEnv
  logoutCleanup?: LogoutCleanup
  projectUser?: ProjectUser
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined

export function createAuthModule({
  clock = systemClock,
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

  if (env.VK_OAUTH_CLIENT_ID && env.VK_OAUTH_CLIENT_SECRET) {
    oauthProviders.register('vk', createVkOAuthProvider({
      clientId: env.VK_OAUTH_CLIENT_ID,
      clientSecret: env.VK_OAUTH_CLIENT_SECRET,
    }))
  }

  const service = new AuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    logoutCleanup,
    oauthProviders: oauthProviders.hasAny() ? oauthProviders : undefined,
    passwords: {
      hash: hashPassword,
      verify: verifyPassword,
    },
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
    repository: createPrismaAuthRepository(db),
  })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))

  return {
    authenticateAccessToken: (accessToken: string | undefined) =>
      service.authenticateAccessToken(accessToken),
    requireAuth,
    routes: createAuthRoutes({
      env,
      oauthCallbackBaseUrl: env.OAUTH_CALLBACK_BASE_URL,
      requireAuth,
      service,
      webappUrl: env.CORS_ORIGINS[0],
    }),
  }
}

export type { AuthHttpEnv }
export type { LogoutCleanup, ProjectUser } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
