import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createApiBodyLimit, createAuthSecurity } from './http/security'
import { createPrismaRequestBudget } from './security/request-budget'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import { createAdminModule } from './modules/admin'
import { createProfileModule } from './modules/profile'
import { createRoomModule } from './modules/room'
import {
  createPersistentTenderModule,
  createPrismaRealtimeTicketIssuer,
  createRealtimeTicketRoutes,
  createTenderRoutes,
  type TenderModule,
} from './modules/tender'
import {
  consoleSecurityEventLogger,
  createSecurityRequestContext,
  type SecurityEventLogger,
} from './security/events'

type CreateAppOptions = {
  env: AppEnv
  prisma: DbClient
  securityEvents?: SecurityEventLogger
  tender?: TenderModule
}

export function createApp({
  env,
  prisma,
  securityEvents = consoleSecurityEventLogger,
  tender: providedTender,
}: CreateAppOptions) {
  const tender = providedTender ?? createPersistentTenderModule(prisma)
  const auth = createAuthModule({
    accountDeletionCleanup: ({ userId }) => tender.anonymizeParticipant(userId),
    db: prisma,
    env,
  })
  const rooms = createRoomModule({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    db: prisma,
    requireAuth: auth.requireAuth,
    tender,
  })
  const profile = createProfileModule({
    db: prisma,
    requireAuth: auth.requireAuth,
  })
  const admin = createAdminModule({
    adminUserIds: new Set(env.ADMIN_USER_IDS),
    authenticate: auth.authenticateAccessToken,
    db: prisma,
    securityEvents,
  })
  const app = new OpenAPIHono<AuthHttpEnv>({
    defaultHook: validationErrorHook,
  })

  app.use(secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }))
  app.use('*', createSecurityRequestContext())
  app.use('*', createApiBodyLimit(env.AUTH_BODY_LIMIT_BYTES, securityEvents))
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      allowHeaders: [
        'Content-Type',
        'Authorization',
        ...(env.NODE_ENV === 'test' && env.TRUSTED_PROXY_CLIENT_IP_HEADER
          ? [env.TRUSTED_PROXY_CLIENT_IP_HEADER]
          : []),
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  for (const middleware of createAuthSecurity({
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    securityEvents,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })) {
    app.use('/api/auth/*', middleware)
  }
  app.get('/', (c) => {
    return c.json({
      name: 'anomaly_detector backend',
      status: 'ok',
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/live', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/ready', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok' }, 200)
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })

  app.route('/api/auth', auth.routes)
  app.route('/api/operations', admin.routes)
  app.route('/api/profile', profile.routes)
  app.route('/api/rooms', rooms.routes)
  app.route('/api/tenders', createTenderRoutes({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    commandBudget: createPrismaRequestBudget(prisma),
    requireAuth: auth.requireAuth,
    tender,
  }))
  app.route('/api/realtime', createRealtimeTicketRoutes({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    issueBudget: createPrismaRequestBudget(prisma),
    issuer: createPrismaRealtimeTicketIssuer(prisma),
    requireAuth: auth.requireAuth,
  }))

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'anomaly_detector API',
      version: '1.0.0',
    },
  })

  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError((error, c) => handleError(error, c, securityEvents))

  return app
}

export type AppType = ReturnType<typeof createApp>
