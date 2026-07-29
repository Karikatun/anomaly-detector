import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'TENDER_ACTION_UNAVAILABLE',
  'TENDER_COMMAND_CONFLICT',
  'TENDER_EVIDENCE_UNAVAILABLE',
  'TENDER_LABORATORY_PAIR_ALREADY_RESEARCHED',
  'TENDER_DEADLINE_EXPIRED',
  'TENDER_PLAYER_FORFEITED',
  'TENDER_VERSION_CONFLICT',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
