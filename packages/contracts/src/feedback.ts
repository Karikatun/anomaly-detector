import { z } from 'zod'

export const feedbackCategorySchema = z.enum(['error', 'suggestion'])
export const feedbackStatusSchema = z.enum(['new', 'in_review', 'resolved', 'rejected'])

export const feedbackRouteTemplateSchema = z.enum([
  '/',
  '/app',
  '/profile',
  '/recover/code',
  '/recover/password',
  '/rooms',
  '/rooms/$roomId',
  '/tenders/$tenderId',
  '/tutorial',
  '/privacy',
  '/personal-data-consent',
  '/terms',
  '/feedback',
  'unknown',
])

export const feedbackTechnicalContextSchema = z.object({
  browserClass: z.enum(['chromium', 'firefox', 'webkit', 'other', 'unknown']),
  buildSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  deviceClass: z.enum(['mobile', 'tablet', 'desktop', 'unknown']),
  errorId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
  routeTemplate: feedbackRouteTemplateSchema,
}).strict()

const feedbackIntakeBasePayloadSchema = z.object({
  linkAccount: z.boolean(),
  replyEmail: z.string().trim().email().max(254).nullable(),
  technicalContext: feedbackTechnicalContextSchema,
})

const boundedFeedbackText = z.string().trim().min(3).max(2_000)

export const feedbackErrorPayloadSchema = feedbackIntakeBasePayloadSchema.extend({
  canContinue: z.boolean(),
  category: z.literal('error'),
  expectedResult: boundedFeedbackText,
  reproductionSteps: boundedFeedbackText,
  whatHappened: boundedFeedbackText,
}).strict()

export const feedbackSuggestionPayloadSchema = feedbackIntakeBasePayloadSchema.extend({
  category: z.literal('suggestion'),
  desiredChange: boundedFeedbackText,
  problemSolved: boundedFeedbackText,
}).strict()

export const feedbackIntakePayloadSchema = z.discriminatedUnion('category', [
  feedbackErrorPayloadSchema,
  feedbackSuggestionPayloadSchema,
])

const feedbackSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
})

export const feedbackErrorIntakeSchema = feedbackErrorPayloadSchema.extend(
  feedbackSubmissionSchema.shape,
).strict()

export const feedbackSuggestionIntakeSchema = feedbackSuggestionPayloadSchema.extend(
  feedbackSubmissionSchema.shape,
).strict()

export const feedbackIntakeRequestSchema = z.discriminatedUnion('category', [
  feedbackErrorIntakeSchema,
  feedbackSuggestionIntakeSchema,
])

export const feedbackIntakeCompatibilityRequestSchema = z.discriminatedUnion('category', [
  feedbackErrorPayloadSchema.extend({
    submissionId: feedbackSubmissionSchema.shape.submissionId.optional(),
  }).strict(),
  feedbackSuggestionPayloadSchema.extend({
    submissionId: feedbackSubmissionSchema.shape.submissionId.optional(),
  }).strict(),
])

export const feedbackReceiptSchema = z.object({
  acceptedAt: z.string().datetime(),
  publicNumber: z.string().regex(/^FB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/),
}).strict()

const feedbackReportBaseSchema = z.object({
  contactDeletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  githubIssueNumber: z.number().int().positive().nullable(),
  id: z.string().uuid(),
  linkedAccountId: z.string().uuid().nullable(),
  publicNumber: z.string().regex(/^FB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/),
  rejectedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().max(500).nullable(),
  replyEmail: z.string().email().max(254).nullable(),
  resolvedAt: z.string().datetime().nullable(),
  status: feedbackStatusSchema,
  takenAt: z.string().datetime().nullable(),
  technicalContext: feedbackTechnicalContextSchema,
  transferredAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
})

export const feedbackErrorReportSchema = feedbackReportBaseSchema.extend({
  canContinue: z.boolean(),
  category: z.literal('error'),
  expectedResult: boundedFeedbackText,
  reproductionSteps: boundedFeedbackText,
  whatHappened: boundedFeedbackText,
}).strict()

export const feedbackSuggestionReportSchema = feedbackReportBaseSchema.extend({
  category: z.literal('suggestion'),
  desiredChange: boundedFeedbackText,
  problemSolved: boundedFeedbackText,
}).strict()

export const feedbackReportSchema = z.discriminatedUnion('category', [
  feedbackErrorReportSchema,
  feedbackSuggestionReportSchema,
])

export const feedbackQueueQuerySchema = z.object({
  category: feedbackCategorySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: feedbackStatusSchema.optional(),
}).strict()

export const feedbackQueueResponseSchema = z.object({
  items: z.array(feedbackReportSchema).max(100),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
}).strict()

const feedbackOperatorCommandBaseSchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
})

export const feedbackTakeCommandSchema = feedbackOperatorCommandBaseSchema.strict()
export const feedbackResolveCommandSchema = feedbackOperatorCommandBaseSchema.strict()
export const feedbackDeleteContactCommandSchema = feedbackOperatorCommandBaseSchema.strict()

export const feedbackRejectCommandSchema = feedbackOperatorCommandBaseSchema.extend({
  reason: z.string().trim().min(3).max(500),
}).strict()

export const feedbackRecordGithubIssueCommandSchema = feedbackOperatorCommandBaseSchema.extend({
  githubIssueNumber: z.number().int().positive().max(2_147_483_647),
}).strict()

export const feedbackOperatorCommandResponseSchema = z.object({
  commandId: z.string().uuid(),
  reportId: z.string().uuid(),
  version: z.number().int().positive(),
}).strict()

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>
export type FeedbackRouteTemplate = z.infer<typeof feedbackRouteTemplateSchema>
export type FeedbackTechnicalContext = z.infer<typeof feedbackTechnicalContextSchema>
export type FeedbackIntakePayload = z.infer<typeof feedbackIntakePayloadSchema>
export type FeedbackIntakeRequest = z.infer<typeof feedbackIntakeRequestSchema>
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>
export type FeedbackReport = z.infer<typeof feedbackReportSchema>
export type FeedbackQueueQuery = z.infer<typeof feedbackQueueQuerySchema>
export type FeedbackQueueResponse = z.infer<typeof feedbackQueueResponseSchema>
export type FeedbackTakeCommand = z.infer<typeof feedbackTakeCommandSchema>
export type FeedbackResolveCommand = z.infer<typeof feedbackResolveCommandSchema>
export type FeedbackDeleteContactCommand = z.infer<typeof feedbackDeleteContactCommandSchema>
export type FeedbackRejectCommand = z.infer<typeof feedbackRejectCommandSchema>
export type FeedbackRecordGithubIssueCommand = z.infer<typeof feedbackRecordGithubIssueCommandSchema>
export type FeedbackOperatorCommandResponse = z.infer<typeof feedbackOperatorCommandResponseSchema>
