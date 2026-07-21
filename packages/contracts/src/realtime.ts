import { z } from 'zod'

import { apiErrorSchema } from './errors'
import { tenderIdSchema, tenderViewSchema } from './tender'

export const realtimeTicketResponseSchema = z.object({
  expiresAt: z.string().datetime(),
  ticket: z.string().min(32),
}).strict()

export const realtimeServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tender-view'), view: tenderViewSchema }).strict(),
  z.object({ type: z.literal('error'), error: apiErrorSchema.shape.error }).strict(),
])

export type RealtimeServerMessage = z.infer<typeof realtimeServerMessageSchema>

export const tenderChangedMessageSchema = z.object({
  tenderId: tenderIdSchema,
}).strict()

export type TenderChangedMessage = z.infer<typeof tenderChangedMessageSchema>
