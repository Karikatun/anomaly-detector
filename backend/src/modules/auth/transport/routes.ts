import {
  apiErrorSchema,
  accountProtectionResponseSchema,
  completePasswordResetRequestSchema,
  cancelRecoveryEmailReplacementRequestSchema,
  cancelRecoveryEmailRequestSchema,
  confirmRecoveryEmailReplacementRequestSchema,
  confirmRecoveryEmailRequestSchema,
  confirmRecoveryCodeReissueRequestSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  oauthCallbackQuerySchema,
  oauthProviderSchema,
  oauthStartRequestSchema,
  oauthStartResponseSchema,
  passwordResetCompletionResponseSchema,
  requestPasswordResetRequestSchema,
  requestPasswordResetResponseSchema,
  registerRequestSchema,
  recoveryEmailReplacementCommandResponseSchema,
  recoveryCodeEmailReplacementConfirmRequestSchema,
  recoveryCodeEmailReplacementConfirmResponseSchema,
  recoveryCodeEmailReplacementStartRequestSchema,
  recoveryCodeEmailReplacementStartResponseSchema,
  recoveryCodePasswordRequestSchema,
  recoveryCodeSetResponseSchema,
  recoveryCodeUseResponseSchema,
  resendRecoveryEmailReplacementRequestSchema,
  resendRecoveryEmailRequestSchema,
  startRecoveryEmailReplacementRequestSchema,
  startRecoveryEmailRequestSchema,
  startRecoveryCodeReissueRequestSchema,
  startRecoveryCodeReissueResponseSchema,
  issueRecoveryCodesRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  updateProfileSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'

import type { AppEnv } from '../../../env'
import { AppError, validationErrorHook } from '../../../http/errors'
import { clientAddress } from '../../../http/security'
import type { AuthService } from '../application/auth-service'
import type { DeviceTokens } from '../application/ports'
import { AuthFailure } from '../domain/errors'
import { userDtoFromPrincipal } from '../domain/user'
import { executeAuth } from './errors'
import type { AuthHttpEnv } from './middleware'

const refreshCookieName = 'anomaly_detector_refresh'
const deviceCookieName = 'anomaly_detector_device'
const deviceTokenTtlSeconds = 180 * 24 * 60 * 60

export const oauthCallbackErrorCode = (error: unknown) =>
  error instanceof AuthFailure
    ? error.kind
    : error instanceof AppError && error.securityReason === 'oauth_registration_consent_required'
      ? error.securityReason
      : 'oauth_failed'

const cookieAuthResponseContent = {
  'application/json': {
    schema: cookieAuthResponseSchema,
  },
}

const tokenAuthResponseContent = {
  'application/json': {
    schema: tokenAuthResponseSchema,
  },
}

const cookieRefreshResponseContent = {
  'application/json': {
    schema: cookieRefreshResponseSchema,
  },
}

const tokenRefreshResponseContent = {
  'application/json': {
    schema: tokenRefreshResponseSchema,
  },
}

const meResponseContent = {
  'application/json': {
    schema: meResponseSchema,
  },
}

const accountProtectionResponseContent = {
  'application/json': {
    schema: accountProtectionResponseSchema,
  },
}

const recoveryEmailReplacementResponseContent = {
  'application/json': {
    schema: recoveryEmailReplacementCommandResponseSchema,
  },
}

const recoveryCodeSetResponseContent = {
  'application/json': { schema: recoveryCodeSetResponseSchema },
}

const recoveryCodeReissueStartResponseContent = {
  'application/json': { schema: startRecoveryCodeReissueResponseSchema },
}

const recoveryCodeUseResponseContent = {
  'application/json': { schema: recoveryCodeUseResponseSchema },
}

const requestPasswordResetResponseContent = {
  'application/json': { schema: requestPasswordResetResponseSchema },
}

const passwordResetCompletionResponseContent = {
  'application/json': { schema: passwordResetCompletionResponseSchema },
}

const recoveryCodeEmailReplacementStartResponseContent = {
  'application/json': { schema: recoveryCodeEmailReplacementStartResponseSchema },
}

const recoveryCodeEmailReplacementConfirmResponseContent = {
  'application/json': { schema: recoveryCodeEmailReplacementConfirmResponseSchema },
}

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const authWriteErrorResponses = {
  413: { content: errorResponseContent, description: 'Request body is too large' },
  429: { content: errorResponseContent, description: 'Too many authentication requests' },
}

const cookieRegisterRoute = createRoute({
  method: 'post',
  path: '/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    201: {
      content: cookieAuthResponseContent,
      description: 'Created user and browser session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
    409: { content: errorResponseContent, description: 'Login already exists' },
  },
})

const tokenRegisterRoute = createRoute({
  method: 'post',
  path: '/token/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    201: {
      content: tokenAuthResponseContent,
      description: 'Created user and explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    409: { content: errorResponseContent, description: 'Login already exists' },
  },
})

const cookieLoginRoute = createRoute({
  method: 'post',
  path: '/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: cookieAuthResponseContent,
      description: 'Created browser session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid credentials' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenLoginRoute = createRoute({
  method: 'post',
  path: '/token/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: tokenAuthResponseContent,
      description: 'Created explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid credentials' },
  },
})

const cookieRefreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  request: {
    body: {
      content: {
        'application/json': {
          schema: cookieRefreshRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: cookieRefreshResponseContent,
      description: 'Rotated browser session and returned a new access token',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh token' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenRefreshRoute = createRoute({
  method: 'post',
  path: '/token/refresh',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tokenRefreshRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: tokenRefreshResponseContent,
      description: 'Rotated explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh token' },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  responses: {
    200: { content: meResponseContent, description: 'Current user' },
    401: { content: errorResponseContent, description: 'Invalid access token' },
  },
})

const accountProtectionRoute = createRoute({
  method: 'get',
  path: '/account-protection',
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Current account protection state',
    },
    401: { content: errorResponseContent, description: 'Invalid access token' },
  },
})

const startRecoveryEmailRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/start',
  request: {
    body: {
      content: {
        'application/json': {
          schema: startRecoveryEmailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Started first Recovery Email confirmation',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication or password invalid' },
    409: { content: errorResponseContent, description: 'Recovery Email conflicts or is pending' },
    429: { content: errorResponseContent, description: 'Recovery Email request limited' },
  },
})

const resendRecoveryEmailRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/resend',
  request: {
    body: {
      content: {
        'application/json': {
          schema: resendRecoveryEmailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Replaced the pending Recovery Email confirmation code',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    429: { content: errorResponseContent, description: 'Recovery Email request limited' },
  },
})

const confirmRecoveryEmailRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/confirm',
  request: {
    body: {
      content: {
        'application/json': {
          schema: confirmRecoveryEmailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Confirmed the first Recovery Email and started cooling off',
    },
    400: { content: errorResponseContent, description: 'Code or Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    409: { content: errorResponseContent, description: 'Recovery Email conflicts' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const cancelRecoveryEmailRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/cancel',
  request: {
    body: {
      content: {
        'application/json': {
          schema: cancelRecoveryEmailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Cancelled pending Recovery Email protection',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    403: { content: errorResponseContent, description: 'Session cannot cancel protection' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const startRecoveryEmailReplacementRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/replacement/start',
  request: {
    body: {
      content: {
        'application/json': { schema: startRecoveryEmailReplacementRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: recoveryEmailReplacementResponseContent,
      description: 'Started two-sided Recovery Email replacement',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication or password invalid' },
    409: { content: errorResponseContent, description: 'Recovery Email conflicts or is pending' },
    429: { content: errorResponseContent, description: 'Recovery Email request limited' },
  },
})

const resendRecoveryEmailReplacementRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/replacement/resend',
  request: {
    body: {
      content: {
        'application/json': { schema: resendRecoveryEmailReplacementRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: recoveryEmailReplacementResponseContent,
      description: 'Replaced one pending Recovery Email replacement code',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    403: { content: errorResponseContent, description: 'Session cannot change replacement' },
    409: { content: errorResponseContent, description: 'Recovery Email factor already confirmed' },
    429: { content: errorResponseContent, description: 'Recovery Email request limited' },
  },
})

const confirmRecoveryEmailReplacementRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/replacement/confirm',
  request: {
    body: {
      content: {
        'application/json': { schema: confirmRecoveryEmailReplacementRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: recoveryEmailReplacementResponseContent,
      description: 'Confirmed one factor or completed Recovery Email replacement',
    },
    400: { content: errorResponseContent, description: 'Code or Recovery Email unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    403: { content: errorResponseContent, description: 'Session cannot confirm replacement' },
    409: { content: errorResponseContent, description: 'Recovery Email conflicts' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const cancelRecoveryEmailReplacementRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-email/replacement/cancel',
  request: {
    body: {
      content: {
        'application/json': { schema: cancelRecoveryEmailReplacementRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: accountProtectionResponseContent,
      description: 'Cancelled a pending Recovery Email replacement',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    403: { content: errorResponseContent, description: 'Session cannot cancel replacement' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const issueRecoveryCodesRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-codes/issue',
  request: {
    body: { content: { 'application/json': { schema: issueRecoveryCodesRequestSchema } } },
  },
  responses: {
    200: {
      content: recoveryCodeSetResponseContent,
      description: 'Issued eight user-held Recovery Codes once',
    },
    401: { content: errorResponseContent, description: 'Authentication required' },
    409: { content: errorResponseContent, description: 'Recovery Codes are unavailable' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const startRecoveryCodeReissueRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-codes/reissue/start',
  request: {
    body: {
      content: { 'application/json': { schema: startRecoveryCodeReissueRequestSchema } },
    },
  },
  responses: {
    200: {
      content: recoveryCodeReissueStartResponseContent,
      description: 'Sent a confirmation code before Recovery Code reissue',
    },
    400: { content: errorResponseContent, description: 'Recovery Email is unavailable' },
    401: { content: errorResponseContent, description: 'Authentication or password invalid' },
    409: { content: errorResponseContent, description: 'Recovery Codes are unavailable' },
    429: { content: errorResponseContent, description: 'Recovery Email request limited' },
  },
})

const confirmRecoveryCodeReissueRoute = createRoute({
  method: 'post',
  path: '/account-protection/recovery-codes/reissue/confirm',
  request: {
    body: {
      content: { 'application/json': { schema: confirmRecoveryCodeReissueRequestSchema } },
    },
  },
  responses: {
    200: {
      content: recoveryCodeSetResponseContent,
      description: 'Replaced the prior Recovery Code set atomically',
    },
    400: { content: errorResponseContent, description: 'Confirmation code is invalid' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    409: { content: errorResponseContent, description: 'Recovery Codes are unavailable' },
    429: { content: errorResponseContent, description: 'Authentication mutation limited' },
  },
})

const recoverPasswordWithRecoveryCodeRoute = createRoute({
  method: 'post',
  path: '/recovery-code/password',
  request: {
    body: { content: { 'application/json': { schema: recoveryCodePasswordRequestSchema } } },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: recoveryCodeUseResponseContent,
      description: 'Returned a non-enumerating Recovery Code password result',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const requestPasswordResetRoute = createRoute({
  method: 'post',
  path: '/password-recovery/request',
  request: {
    body: { content: { 'application/json': { schema: requestPasswordResetRequestSchema } } },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: requestPasswordResetResponseContent,
      description: 'Returned a non-enumerating password recovery request result',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const completePasswordResetRoute = createRoute({
  method: 'post',
  path: '/password-recovery/complete',
  request: {
    body: { content: { 'application/json': { schema: completePasswordResetRequestSchema } } },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: passwordResetCompletionResponseContent,
      description: 'Consumed one password reset credential without creating a session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const startRecoveryEmailWithRecoveryCodeRoute = createRoute({
  method: 'post',
  path: '/recovery-code/recovery-email/start',
  request: {
    body: {
      content: { 'application/json': { schema: recoveryCodeEmailReplacementStartRequestSchema } },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: recoveryCodeEmailReplacementStartResponseContent,
      description: 'Returned a non-enumerating Recovery Email replacement result',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const confirmRecoveryEmailWithRecoveryCodeRoute = createRoute({
  method: 'post',
  path: '/recovery-code/recovery-email/confirm',
  request: {
    body: {
      content: { 'application/json': { schema: recoveryCodeEmailReplacementConfirmRequestSchema } },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: recoveryCodeEmailReplacementConfirmResponseContent,
      description: 'Returned a non-enumerating Recovery Email confirmation result',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const cookieLogoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  request: {
    body: {
      content: {
        'application/json': {
          schema: cookieLogoutRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    204: { description: 'Browser session revoked' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenLogoutRoute = createRoute({
  method: 'post',
  path: '/token/logout',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tokenLogoutRequestSchema,
        },
      },
    },
  },
  responses: {
    ...authWriteErrorResponses,
    204: { description: 'Explicit token session revoked' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/account',
  responses: {
    204: { description: 'Account deleted and anonymised' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    429: { content: errorResponseContent, description: 'Authenticated mutation rate limited' },
  },
})

const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/profile',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateProfileSchema,
        },
      },
    },
  },
  responses: {
    204: { description: 'Profile updated' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Authentication required' },
    429: { content: errorResponseContent, description: 'Authenticated mutation rate limited' },
  },
})

// ── OAuth Routes ─────────────────────────────────────────────────────────────

const oauthStartRoute = createRoute({
  method: 'post',
  path: '/oauth/{provider}/start',
  request: {
    params: z.object({ provider: oauthProviderSchema }),
    body: {
      content: {
        'application/json': {
          schema: oauthStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: oauthStartResponseSchema } },
      description: 'OAuth authorization URL',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    501: { content: errorResponseContent, description: 'OAuth provider not configured' },
  },
})

const oauthCallbackRoute = createRoute({
  method: 'get',
  path: '/oauth/{provider}/callback',
  request: {
    params: z.object({ provider: oauthProviderSchema }),
    query: oauthCallbackQuerySchema,
  },
  responses: {
    302: { description: 'Redirect back to the webapp with session' },
    400: { content: errorResponseContent, description: 'Invalid OAuth callback' },
    401: { content: errorResponseContent, description: 'OAuth transaction invalid or expired' },
  },
})

// ── Factory ──────────────────────────────────────────────────────────────────

type CreateAuthRoutesOptions = {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  deviceTokens: DeviceTokens
  env: AppEnv
  oauthCallbackBaseUrl?: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: AuthService
  webappUrl: string
}

export function createAuthRoutes({
  authenticatedMutationBudget,
  deviceTokens,
  env,
  oauthCallbackBaseUrl,
  requireAuth,
  service,
  webappUrl,
}: CreateAuthRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const protectedRoutes = new OpenAPIHono<AuthHttpEnv>({
    defaultHook: validationErrorHook,
  })

  routes.openapi(cookieRegisterRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const device = registrationDevice(c, deviceTokens)
    const result = await executeAuth(() => service.register(
      c.req.valid('json'),
      requestMetadata(c, env),
      { deviceId: device.deviceId },
    ))
    setRefreshCookie(c, result.refreshToken, env)
    setDeviceCookie(c, device.cookieValue, env)
    return c.json(withoutRefreshToken(result), 201)
  })

  routes.openapi(tokenRegisterRoute, async (c) => {
    const result = await executeAuth(() => service.register(
      c.req.valid('json'),
      requestMetadata(c, env),
      {},
    ))
    return c.json(result, 201)
  })

  routes.openapi(cookieLoginRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.login(c.req.valid('json'), requestMetadata(c, env)))
    setRefreshCookie(c, result.refreshToken, env)
    return c.json(withoutRefreshToken(result), 200)
  })

  routes.openapi(tokenLoginRoute, async (c) => {
    const result = await executeAuth(() => service.login(c.req.valid('json'), requestMetadata(c, env)))
    return c.json(result, 200)
  })

  routes.openapi(recoverPasswordWithRecoveryCodeRoute, async (c) => {
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.recoverPasswordWithRecoveryCode({
      ipAddress: metadata.ipAddress,
      login: request.login,
      newPassword: request.newPassword,
      recoveryCode: request.recoveryCode,
    })), 200)
  })

  routes.openapi(requestPasswordResetRoute, async (c) => {
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.requestPasswordReset({
      ipAddress: metadata.ipAddress,
      login: request.login,
    })), 200)
  })

  routes.openapi(completePasswordResetRoute, async (c) => {
    const request = c.req.valid('json')
    return c.json(await executeAuth(() => service.completePasswordReset({
      newPassword: request.newPassword,
      token: request.token,
    })), 200)
  })

  routes.openapi(startRecoveryEmailWithRecoveryCodeRoute, async (c) => {
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.startRecoveryEmailWithRecoveryCode({
      email: request.email,
      ipAddress: metadata.ipAddress,
      login: request.login,
      recoveryCode: request.recoveryCode,
    })), 200)
  })

  routes.openapi(confirmRecoveryEmailWithRecoveryCodeRoute, async (c) => {
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.confirmRecoveryEmailWithRecoveryCode({
      code: request.code,
      ipAddress: metadata.ipAddress,
      login: request.login,
    })), 200)
  })

  routes.openapi(cookieRefreshRoute, async (c) => {
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.refresh(cookieRefreshToken, requestMetadata(c, env)))
    setRefreshCookie(c, result.refreshToken, env)
    return c.json(withoutRefreshToken(result), 200)
  })

  routes.openapi(tokenRefreshRoute, async (c) => {
    const result = await executeAuth(() =>
      service.refresh(c.req.valid('json').refreshToken, requestMetadata(c, env)),
    )
    return c.json(result, 200)
  })

  protectedRoutes.use('/me', requireAuth)
  protectedRoutes.openapi(meRoute, async (c) => {
    return c.json({ user: userDtoFromPrincipal(c.var.user) }, 200)
  })
  protectedRoutes.use('/account-protection', requireAuth)
  protectedRoutes.openapi(accountProtectionRoute, async (c) => {
    return c.json(await executeAuth(() => service.getAccountProtection(
      c.var.user.id,
      c.var.user.sessionId,
    )), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/start', requireAuth)
  protectedRoutes.use('/account-protection/recovery-email/start', authenticatedMutationBudget)
  protectedRoutes.openapi(startRecoveryEmailRoute, async (c) => {
    const user = c.var.user
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.startRecoveryEmail({
      email: request.email,
      ipAddress: metadata.ipAddress,
      password: request.password,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/resend', requireAuth)
  protectedRoutes.use('/account-protection/recovery-email/resend', authenticatedMutationBudget)
  protectedRoutes.openapi(resendRecoveryEmailRoute, async (c) => {
    const user = c.var.user
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.resendRecoveryEmail({
      ipAddress: metadata.ipAddress,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/confirm', requireAuth)
  protectedRoutes.use('/account-protection/recovery-email/confirm', authenticatedMutationBudget)
  protectedRoutes.openapi(confirmRecoveryEmailRoute, async (c) => {
    const user = c.var.user
    return c.json(await executeAuth(() => service.confirmRecoveryEmail({
      code: c.req.valid('json').code,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/cancel', requireAuth)
  protectedRoutes.use('/account-protection/recovery-email/cancel', authenticatedMutationBudget)
  protectedRoutes.openapi(cancelRecoveryEmailRoute, async (c) => {
    const user = c.var.user
    return c.json(await executeAuth(() => service.cancelRecoveryEmail({
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/replacement/start', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-email/replacement/start',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(startRecoveryEmailReplacementRoute, async (c) => {
    const user = c.var.user
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.startRecoveryEmailReplacement({
      email: request.email,
      ipAddress: metadata.ipAddress,
      password: request.password,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/replacement/resend', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-email/replacement/resend',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(resendRecoveryEmailReplacementRoute, async (c) => {
    const user = c.var.user
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.resendRecoveryEmailReplacement({
      factor: request.factor,
      ipAddress: metadata.ipAddress,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/replacement/confirm', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-email/replacement/confirm',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(confirmRecoveryEmailReplacementRoute, async (c) => {
    const user = c.var.user
    const request = c.req.valid('json')
    return c.json(await executeAuth(() => service.confirmRecoveryEmailReplacement({
      code: request.code,
      factor: request.factor,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-email/replacement/cancel', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-email/replacement/cancel',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(cancelRecoveryEmailReplacementRoute, async (c) => {
    const user = c.var.user
    return c.json(await executeAuth(() => service.cancelRecoveryEmailReplacement({
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-codes/issue', requireAuth)
  protectedRoutes.use('/account-protection/recovery-codes/issue', authenticatedMutationBudget)
  protectedRoutes.openapi(issueRecoveryCodesRoute, async (c) => {
    const user = c.var.user
    return c.json(await executeAuth(() => service.issueRecoveryCodes({
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-codes/reissue/start', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-codes/reissue/start',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(startRecoveryCodeReissueRoute, async (c) => {
    const user = c.var.user
    const request = c.req.valid('json')
    const metadata = requestMetadata(c, env)
    return c.json(await executeAuth(() => service.startRecoveryCodeReissue({
      ipAddress: metadata.ipAddress,
      password: request.password,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account-protection/recovery-codes/reissue/confirm', requireAuth)
  protectedRoutes.use(
    '/account-protection/recovery-codes/reissue/confirm',
    authenticatedMutationBudget,
  )
  protectedRoutes.openapi(confirmRecoveryCodeReissueRoute, async (c) => {
    const user = c.var.user
    return c.json(await executeAuth(() => service.confirmRecoveryCodeReissue({
      code: c.req.valid('json').code,
      sessionId: user.sessionId,
      userId: user.id,
    })), 200)
  })
  protectedRoutes.use('/account', requireAuth)
  protectedRoutes.use('/account', authenticatedMutationBudget)
  protectedRoutes.openapi(deleteAccountRoute, async (c) => {
    const user = c.var.user
    await executeAuth(() => service.deleteAccount({
      authenticatedAt: user.authenticatedAt,
      userId: user.id,
    }))
    deleteRefreshCookie(c, env)
    return c.body(null, 204)
  })
  protectedRoutes.use('/profile', requireAuth)
  protectedRoutes.use('/profile', authenticatedMutationBudget)
  protectedRoutes.openapi(updateProfileRoute, async (c) => {
    const userId = c.var.user.id
    await executeAuth(() => service.updateProfile(userId, c.req.valid('json')))
    return c.body(null, 204)
  })
  routes.route('/', protectedRoutes)

  // ── OAuth handlers ───────────────────────────────────────────────────────

  routes.openapi(oauthStartRoute, async (c) => {
    const { provider } = c.req.valid('param')
    const { registration, webappOrigin: bodyWebappOrigin } = c.req.valid('json')
    const webappOrigin = trustedOAuthWebappOrigin(bodyWebappOrigin ?? webappUrl, webappUrl)
    if (!oauthCallbackBaseUrl) {
      throw new AppError(500, 'INTERNAL_ERROR', 'OAuth callback URL is not configured')
    }
    const redirectUri = new URL(`/api/auth/oauth/${provider}/callback`, oauthCallbackBaseUrl).toString()
    const result = await executeAuth(() => service.startOAuthSignIn({
      provider,
      redirectUri,
      registration,
      webappOrigin,
    }))
    return c.json(result, 200)
  })

  routes.openapi(oauthCallbackRoute, async (c) => {
    const { provider: _provider } = c.req.valid('param')
    const query = c.req.valid('query')

    // OAuth provider returned an error (e.g. redirect_uri mismatch)
    if (query.error) {
      const redirectUrl = new URL(webappUrl)
      redirectUrl.pathname = '/'
      redirectUrl.searchParams.set('auth_error', query.error_description ?? query.error)
      return c.redirect(redirectUrl.toString(), 302)
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- refined by query.error check above
    const { code, state } = query as { code: string; state: string }
    try {
      const result = await executeAuth(() =>
        service.completeOAuthSignIn({ code, state, metadata: requestMetadata(c, env) }),
      )
      // Set session cookie and redirect to webapp
      // Note: must set cookie on the response manually because c.redirect()
      // discards headers set by setCookie() from hono/cookie
      const redirectUrl = new URL(trustedOAuthWebappOrigin(result.webappOrigin, webappUrl))
      redirectUrl.pathname = '/'
      if (result.created) redirectUrl.searchParams.set('analytics_registration', '1')
      const cookieMaxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
      const cookieSameSite = env.COOKIE_SECURE ? 'None' : 'Lax'
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
          'Set-Cookie':
            `${refreshCookieName}=${result.refreshToken}; HttpOnly${env.COOKIE_SECURE ? '; Secure' : ''}; SameSite=${cookieSameSite}; Path=/api/auth; Max-Age=${cookieMaxAge}`,
        },
      })
    } catch (error) {
      console.error('OAuth callback failed', {
        code: oauthCallbackErrorCode(error),
      })
      const redirectUrl = new URL(webappUrl)
      redirectUrl.pathname = '/'
      redirectUrl.searchParams.set('auth_error', oauthCallbackErrorCode(error))
      return c.redirect(redirectUrl.toString(), 302)
    }
  })

  routes.openapi(cookieLogoutRoute, async (c) => {
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieOrigin(c, env)
    await executeAuth(() => service.logout(cookieRefreshToken))
    deleteRefreshCookie(c, env)
    return c.body(null, 204)
  })

  routes.openapi(tokenLogoutRoute, async (c) => {
    await executeAuth(() => service.logout(c.req.valid('json').refreshToken))
    return c.body(null, 204)
  })

  return routes
}

function requestMetadata(c: Context, env: AppEnv): { userAgent?: string; ipAddress?: string } {
  const ipAddress = clientAddress(c, {
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })
  return {
    userAgent: c.req.header('user-agent'),
    ipAddress: ipAddress === 'unknown' ? undefined : ipAddress,
  }
}

function getRefreshCookie(c: Context) {
  return getCookie(c, refreshCookieName)
}

function registrationDevice(c: Context, deviceTokens: DeviceTokens) {
  return deviceTokens.resolve(getCookie(c, deviceCookieName))
}

function setDeviceCookie(c: Context, value: string | null, env: AppEnv) {
  if (!value) return
  setCookie(c, deviceCookieName, value, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: refreshCookieSameSite(env),
    path: '/api/auth',
    maxAge: deviceTokenTtlSeconds,
  })
}

function assertTrustedCookieOrigin(c: Context, env: AppEnv) {
  if (!env.COOKIE_SECURE) return

  const origin = c.req.header('origin')
  if (origin && env.CORS_ORIGINS.includes(origin)) return

  throw new AppError(403, 'FORBIDDEN', 'Cookie auth requests require a trusted Origin')
}

function setRefreshCookie(c: Context, refreshToken: string, env: AppEnv) {
  setCookie(c, refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: refreshCookieSameSite(env),
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  })
}

function deleteRefreshCookie(c: Context, env: AppEnv) {
  deleteCookie(c, refreshCookieName, {
    path: '/api/auth',
    secure: env.COOKIE_SECURE,
    sameSite: refreshCookieSameSite(env),
  })
}

function refreshCookieSameSite(env: AppEnv) {
  return env.COOKIE_SECURE ? 'None' : 'Lax'
}

function withoutRefreshToken<T extends { refreshToken: string }>(response: T): Omit<T, 'refreshToken'> {
  const { refreshToken: _refreshToken, ...cookieResponse } = response
  return cookieResponse
}

function trustedOAuthWebappOrigin(candidate: string, webappUrl: string) {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AppError(403, 'FORBIDDEN', 'OAuth redirect origin is not trusted')
  }
  if (url.origin !== candidate || url.origin !== webappUrl) {
    throw new AppError(403, 'FORBIDDEN', 'OAuth redirect origin is not trusted')
  }
  return url.origin
}
