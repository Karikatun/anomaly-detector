import { z } from 'zod'

export const realtimeTicketResponseSchema = z.object({
  expiresAt: z.string().datetime(),
  ticket: z.string().min(32),
}).strict()
