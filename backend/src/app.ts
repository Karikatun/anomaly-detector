import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { clientAddress, createApiBodyLimit, createAuthSecurity } from './http/security'
import { createPrismaRequestBudget } from './security/request-budget'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import { createAdminModule } from './modules/admin'
import { createFeedbackModule } from './modules/feedback'
import { createMailModule, type MailServiceCandidateSource } from './modules/mail'
import { createProfileModule } from './modules/profile'
import { createRoomModule } from './modules/room'
import {
  createPersistentCompletedTenderSummaryReader,
  createPersistentTenderLifecycleReader,
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
  mailPolicySource?: MailServiceCandidateSource
  tender?: TenderModule
}

export function createApp({
  env,
  mailPolicySource,
  prisma,
  securityEvents = consoleSecurityEventLogger,
  tender: providedTender,
}: CreateAppOptions) {
  const tender = providedTender ?? createPersistentTenderModule(prisma)
  const mail = createMailModule({
    db: prisma,
    deliveryStatus: {
      configured: env.MAIL_SMTP_ENABLED,
      deliveryBudgetPerMinute: env.MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE,
    },
    source: mailPolicySource,
  })
  const auth = createAuthModule({
    accountDeletionCleanup: ({ userId }) => tender.anonymizeParticipant(userId),
    accountEmailCanonicalizer: mail.accountEmailCanonicalizer,
    db: prisma,
    env,
  })
  const rooms = createRoomModule({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    db: prisma,
    requireAuth: auth.requireAuth,
    tender,
    tenderLifecycleReader: createPersistentTenderLifecycleReader(prisma),
  })
  const profile = createProfileModule({
    completedTenderSummaryReader: createPersistentCompletedTenderSummaryReader(prisma),
    db: prisma,
    requireAuth: auth.requireAuth,
  })
  const feedback = createFeedbackModule({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    clientAddress: (context) => clientAddress(context, {
      trustProxy: env.TRUST_PROXY,
      trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
      trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
    }),
    db: prisma,
    fingerprintKey: env.JWT_SECRET,
    requireAuth: auth.requireAuth,
  })
  const admin = createAdminModule({
    adminUserIds: new Set(env.ADMIN_USER_IDS),
    authenticate: auth.authenticateAccessToken,
    db: prisma,
    feedback: feedback.operator,
    mailPolicy: mail.operatorPolicy,
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
  app.route('/api/feedback', feedback.routes)
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
