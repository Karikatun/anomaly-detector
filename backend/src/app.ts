import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { clientAddress, createApiBodyLimit, createAuthSecurity } from './http/security'
import { createPrismaRequestBudget } from './security/request-budget'
import {
  createRequestBudgetPolicyCatalog,
  requestBudgetPolicyEntries,
} from './security/request-budget-policy'
import { createRequestBudgetOverviewReader } from './security/request-budget-overview'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import { createAnalyticsModule } from './modules/analytics'
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
  const requestBudgetPolicies = createRequestBudgetPolicyCatalog(env)
  const requestBudget = createPrismaRequestBudget(prisma, env.JWT_SECRET)
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
    requestBudgetPolicies,
  })
  const rooms = createRoomModule({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    db: prisma,
    joinBudgetPolicy: requestBudgetPolicies.room_join,
    requireAuth: auth.requireAuth,
    requestBudgetSecret: env.JWT_SECRET,
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
  const analytics = env.ANALYTICS_ENABLED
    ? createAnalyticsModule({
        campaignAllowlist: new Set(env.ANALYTICS_CAMPAIGN_ALLOWLIST),
        cookieSecure: env.COOKIE_SECURE,
        db: prisma,
        fingerprintKey: env.JWT_SECRET,
      })
    : null
  const admin = createAdminModule({
    adminUserIds: new Set(env.ADMIN_USER_IDS),
    ...(analytics ? { analyticsReader: { read: analytics.store.readOverview } } : {}),
    authenticate: auth.authenticateAccessToken,
    db: prisma,
    feedback: feedback.operator,
    mailPolicy: mail.operatorPolicy,
    requestBudgetOverviewReader: createRequestBudgetOverviewReader(
      prisma,
      requestBudgetPolicyEntries(requestBudgetPolicies),
    ),
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
      origin: (origin, context) => {
        const origins = context.req.path.startsWith('/api/analytics/')
          ? env.ANALYTICS_ORIGINS
          : env.CORS_ORIGINS
        if (!origin) return origins[0] ?? null
        return origins.includes(origin) ? origin : null
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
  if (analytics) app.route('/api/analytics', analytics.routes)
  app.route('/api/feedback', feedback.routes)
  app.route('/api/operations', admin.routes)
  app.route('/api/profile', profile.routes)
  app.route('/api/rooms', rooms.routes)
  app.route('/api/tenders', createTenderRoutes({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    commandBudget: requestBudget,
    commandBudgetPolicy: requestBudgetPolicies.tender_command,
    requireAuth: auth.requireAuth,
    tender,
  }))
  app.route('/api/realtime', createRealtimeTicketRoutes({
    authenticatedMutationBudget: auth.authenticatedMutationBudget,
    issueBudget: requestBudget,
    issueBudgetPolicy: requestBudgetPolicies.realtime_ticket_issue,
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
