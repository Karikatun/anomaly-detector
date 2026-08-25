import { z } from 'zod'

export const adminOverviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict()

const adminUserSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.string().datetime(),
}).strict()

export const adminOverviewSchema = z.object({
  generatedAt: z.string().datetime(),
  totals: z.object({
    users: z.number().int().nonnegative(),
    activeSessions: z.number().int().nonnegative(),
    rooms: z.number().int().nonnegative(),
    tenders: z.number().int().nonnegative(),
  }).strict(),
  roomsByStatus: z.object({
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }).strict(),
  tendersByPhase: z.array(z.object({
    phase: z.string().min(1),
    count: z.number().int().nonnegative(),
  }).strict()),
  users: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().min(1),
    items: z.array(adminUserSchema).max(100),
  }).strict(),
}).strict()

export type AdminOverviewQuery = z.infer<typeof adminOverviewQuerySchema>
export type AdminOverview = z.infer<typeof adminOverviewSchema>

const mailPolicyCanonicalizationSchema = z.object({
  ignoreDots: z.boolean(),
  localPartCaseInsensitive: z.boolean(),
  stripPlusTag: z.boolean(),
}).strict()

const mailProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/)

const mailPolicyPublicDomainSchema = z.object({
  canonicalization: mailPolicyCanonicalizationSchema,
  emailDomain: z.string().min(1).max(253),
}).strict()

const mailProviderDefinitionSchema = z.object({
  customDomain: z.object({
    allowedZones: z.array(z.enum(['ru', 'xn--p1ai'])).min(1).max(2),
    mxExchanges: z.array(z.string().min(1).max(253)).min(1).max(8),
  }).strict().nullable(),
  displayName: z.string().min(1).max(100),
  evidenceUrl: z.string().url(),
  providerId: mailProviderIdSchema,
  publicDomains: z.array(mailPolicyPublicDomainSchema).max(20),
}).strict()

const mailPolicyProviderSchema = mailProviderDefinitionSchema.extend({
  reason: z.string().min(1).max(500).nullable(),
  state: z.enum(['approved', 'deprecated', 'blocked']),
}).strict()

export const mailPolicyViewSchema = z.object({
  availableCatalog: z.object({
    diff: z.object({
      addedProviderIds: z.array(mailProviderIdSchema).max(100),
      changedProviderIds: z.array(mailProviderIdSchema).max(100),
      removedProviderIds: z.array(mailProviderIdSchema).max(100),
    }).strict(),
    providers: z.array(mailProviderDefinitionSchema).max(100),
    version: z.number().int().positive(),
  }).strict(),
  currentVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  publishedPolicy: z.object({
    catalogVersion: z.number().int().positive(),
    providers: z.array(mailPolicyProviderSchema).max(100),
    publishedAt: z.string().datetime(),
    version: z.number().int().positive(),
  }).strict().nullable(),
}).strict()

const mailDeliveryGroupSchema = z.object({
  providerId: mailProviderIdSchema,
  smtpAccepted: z.number().int().nonnegative(),
  templateKind: z.enum([
    'account_email_confirmation',
    'password_recovery',
    'security_notification',
  ]),
  temporaryFailures: z.number().int().nonnegative(),
  terminalFailures: z.number().int().nonnegative(),
  requested: z.number().int().min(5),
}).strict()

export const mailDeliveryOverviewSchema = z.object({
  budget: z.object({
    limitPerMinute: z.number().int().positive(),
    usedInWindow: z.number().int().nonnegative(),
    windowStartedAt: z.string().datetime().nullable(),
  }).strict(),
  circuit: z.object({
    consecutiveFailures: z.number().int().nonnegative(),
    openUntil: z.string().datetime().nullable(),
    state: z.enum(['disabled', 'closed', 'open']),
  }).strict(),
  configured: z.boolean(),
  groups: z.array(mailDeliveryGroupSchema).max(50),
  lastSmtpSuccessAt: z.string().datetime().nullable(),
  outbox: z.object({
    leased: z.number().int().nonnegative(),
    oldestQueuedAt: z.string().datetime().nullable(),
    queued: z.number().int().nonnegative(),
  }).strict(),
  provider: z.literal('reg_ru'),
  catalogLastSyncedAt: z.string().datetime().nullable(),
  totals: z.object({
    requested: z.number().int().nonnegative(),
    smtpAccepted: z.number().int().nonnegative(),
    temporaryFailures: z.number().int().nonnegative(),
    terminalFailures: z.number().int().nonnegative(),
  }).strict(),
}).strict()

const requestBudgetSurfaceSchema = z.enum([
  'authentication',
  'transactional_mail',
  'room_join',
  'tender_command',
  'realtime',
])

const requestBudgetGroupSchema = z.object({
  exhaustedBudgetKeysAtLeast: z.number().int().min(10).multipleOf(10),
  surface: requestBudgetSurfaceSchema,
}).strict()

export const requestBudgetOverviewSchema = z.object({
  groups: z.array(requestBudgetGroupSchema).max(5),
  minimumGroupSize: z.literal(10),
  roundingStep: z.literal(10),
}).strict()

export const mailOperationsViewSchema = mailPolicyViewSchema.extend({
  delivery: mailDeliveryOverviewSchema,
}).strict()

const mailPolicyCommandBaseSchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
})

export const mailPolicySyncCommandSchema = mailPolicyCommandBaseSchema.strict()

export const mailPolicyStatusCommandSchema = mailPolicyCommandBaseSchema.extend({
  providerId: mailProviderIdSchema,
  reason: z.string().trim().min(3).max(500),
  state: z.enum(['deprecated', 'blocked']),
}).strict()

export type MailPolicyView = z.infer<typeof mailPolicyViewSchema>
export type MailDeliveryOverview = z.infer<typeof mailDeliveryOverviewSchema>
export type RequestBudgetOverview = z.infer<typeof requestBudgetOverviewSchema>
export type RequestBudgetSurface = z.infer<typeof requestBudgetSurfaceSchema>
export type MailOperationsView = z.infer<typeof mailOperationsViewSchema>
export type MailPolicyProvider = z.infer<typeof mailPolicyProviderSchema>
export type MailProviderDefinition = z.infer<typeof mailProviderDefinitionSchema>
export type MailPolicyCanonicalization = z.infer<typeof mailPolicyCanonicalizationSchema>
export type MailPolicySyncCommand = z.infer<typeof mailPolicySyncCommandSchema>
export type MailPolicyStatusCommand = z.infer<typeof mailPolicyStatusCommandSchema>
