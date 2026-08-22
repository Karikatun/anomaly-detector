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

const mailRegistryCandidateSchema = z.object({
  evidence: z.literal('service_description_mentions_mail'),
  id: z.string().uuid(),
  registryEntryId: z.string().min(1).max(64),
  serviceDomain: z.string().min(1).max(253),
}).strict()

const mailRegistryAttemptSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  failureCode: z.string().min(1).max(64).nullable(),
  finishedAt: z.string().datetime(),
  id: z.string().uuid(),
  outcome: z.enum(['succeeded', 'failed', 'rejected']),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceUrl: z.string().url().nullable(),
}).strict()

const mailPolicyCanonicalizationSchema = z.object({
  ignoreDots: z.boolean(),
  localPartCaseInsensitive: z.boolean(),
  stripPlusTag: z.boolean(),
}).strict()

const mailPolicyEntrySchema = z.object({
  canonicalization: mailPolicyCanonicalizationSchema,
  emailDomain: z.string().min(1).max(253),
  reason: z.string().min(1).max(500).nullable(),
  sourceCandidateId: z.string().uuid(),
  state: z.enum(['approved', 'deprecated', 'blocked']),
}).strict()

export const mailPolicyViewSchema = z.object({
  currentVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  latestAttempt: mailRegistryAttemptSchema.nullable(),
  lastSuccessfulImport: z.object({
    candidates: z.array(mailRegistryCandidateSchema).max(5_000),
    diff: z.object({
      added: z.array(z.string().min(1).max(253)).max(5_000),
      removed: z.array(z.string().min(1).max(253)).max(5_000),
      unchangedCount: z.number().int().nonnegative().max(5_000),
    }).strict(),
    importId: z.string().uuid(),
  }).strict().nullable(),
  publishedPolicy: z.object({
    entries: z.array(mailPolicyEntrySchema).max(100),
    publishedAt: z.string().datetime(),
    version: z.number().int().positive(),
  }).strict().nullable(),
}).strict()

const mailDeliveryGroupSchema = z.object({
  service: z.string().min(1).max(253),
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
  registryLastSuccessfulImportAt: z.string().datetime().nullable(),
  totals: z.object({
    requested: z.number().int().nonnegative(),
    smtpAccepted: z.number().int().nonnegative(),
    temporaryFailures: z.number().int().nonnegative(),
    terminalFailures: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export const mailOperationsViewSchema = mailPolicyViewSchema.extend({
  delivery: mailDeliveryOverviewSchema,
}).strict()

const mailPolicyCommandBaseSchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
})

export const mailPolicyImportCommandSchema = mailPolicyCommandBaseSchema.strict()

export const mailPolicyPublishCommandSchema = mailPolicyCommandBaseSchema.extend({
  additions: z.array(z.object({
    canonicalization: mailPolicyCanonicalizationSchema,
    emailDomain: z.string().trim().min(1).max(253),
    sourceCandidateId: z.string().uuid(),
  }).strict()).min(1).max(20),
}).strict()

export const mailPolicyStatusCommandSchema = mailPolicyCommandBaseSchema.extend({
  emailDomain: z.string().trim().min(1).max(253),
  reason: z.string().trim().min(3).max(500),
  state: z.enum(['deprecated', 'blocked']),
}).strict()

export type MailPolicyView = z.infer<typeof mailPolicyViewSchema>
export type MailDeliveryOverview = z.infer<typeof mailDeliveryOverviewSchema>
export type MailOperationsView = z.infer<typeof mailOperationsViewSchema>
export type MailPolicyEntry = z.infer<typeof mailPolicyEntrySchema>
export type MailPolicyCanonicalization = z.infer<typeof mailPolicyCanonicalizationSchema>
export type MailRegistryCandidate = z.infer<typeof mailRegistryCandidateSchema>
export type MailPolicyImportCommand = z.infer<typeof mailPolicyImportCommandSchema>
export type MailPolicyPublishCommand = z.infer<typeof mailPolicyPublishCommandSchema>
export type MailPolicyStatusCommand = z.infer<typeof mailPolicyStatusCommandSchema>
