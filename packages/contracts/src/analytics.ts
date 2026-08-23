import { z } from 'zod'

export const analyticsFunnelEventSchema = z.enum([
  'landing_view',
  'tutorial_cta',
  'registration_complete',
  'tutorial_complete',
  'recovery_email_confirmed',
])

export const analyticsLinkedEventSchema = z.enum([
  'tutorial_cta',
  'registration_complete',
  'tutorial_complete',
  'recovery_email_confirmed',
])

export const analyticsSourceCategorySchema = z.enum([
  'direct',
  'referral',
  'campaign',
  'unknown',
])

export const analyticsTrafficClassSchema = z.enum(['human', 'known_bot'])

const analyticsReferrerDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/)
  .nullable()

const analyticsCampaignSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable()

export const analyticsLandingViewSchema = z.object({
  campaign: analyticsCampaignSchema,
  referrerDomain: analyticsReferrerDomainSchema,
}).strict()

export const analyticsConsentCommandSchema = analyticsLandingViewSchema.extend({
  commandId: z.string().uuid(),
}).strict()

export const analyticsEventCommandSchema = z.object({
  event: analyticsLinkedEventSchema,
}).strict()

export const analyticsConsentStatusSchema = z.object({
  expiresAt: z.string().datetime().nullable(),
  mode: z.enum(['undecided', 'allowed', 'necessary']),
}).strict()

export const analyticsAdminQuerySchema = z.object({
  windowDays: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])),
}).strict()

const analyticsCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const analyticsAdminOverviewSchema = z.object({
  botLandingViews: analyticsCountSchema,
  daily: z.array(z.object({
    count: analyticsCountSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    event: analyticsFunnelEventSchema,
  }).strict()).max(90 * 5),
  generatedAt: z.string().datetime(),
  sources: z.array(z.object({
    category: analyticsSourceCategorySchema,
    landingViews: analyticsCountSchema,
  }).strict()).max(4),
  steps: z.array(z.object({
    count: analyticsCountSchema,
    event: analyticsFunnelEventSchema,
  }).strict()).max(5),
  transitions: z.array(z.object({
    conversionRate: z.number().finite().min(0).max(1),
    count: analyticsCountSchema,
    from: analyticsFunnelEventSchema,
    to: analyticsFunnelEventSchema,
  }).strict()).max(4),
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
}).strict()

export type AnalyticsFunnelEvent = z.infer<typeof analyticsFunnelEventSchema>
export type AnalyticsLinkedEvent = z.infer<typeof analyticsLinkedEventSchema>
export type AnalyticsSourceCategory = z.infer<typeof analyticsSourceCategorySchema>
export type AnalyticsTrafficClass = z.infer<typeof analyticsTrafficClassSchema>
export type AnalyticsLandingView = z.infer<typeof analyticsLandingViewSchema>
export type AnalyticsConsentCommand = z.infer<typeof analyticsConsentCommandSchema>
export type AnalyticsEventCommand = z.infer<typeof analyticsEventCommandSchema>
export type AnalyticsConsentStatus = z.infer<typeof analyticsConsentStatusSchema>
export type AnalyticsAdminQuery = z.infer<typeof analyticsAdminQuerySchema>
export type AnalyticsAdminOverview = z.infer<typeof analyticsAdminOverviewSchema>
