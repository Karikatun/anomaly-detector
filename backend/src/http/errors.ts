import type { ApiErrorCode, ApiErrorResponse } from '@anomaly-detector/contracts'
import type { Context, Env } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import {
  emitSecurityEvent,
  type SecurityEventLogger,
} from '../security/events'

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly securityReason?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }
}

type ValidationHookResult = { success: true } | { success: false; error: ZodError }

export function validationErrorResponse(details: unknown) {
  return errorResponse('VALIDATION_ERROR', 'Invalid request payload', details)
}

export function validationErrorHook(result: ValidationHookResult, c: Context) {
  if (!result.success) {
    return c.json(validationErrorResponse(result.error.issues), 400)
  }
}

export function handleError<
  E extends Env & { Variables: { securityRequestId: string } },
>(
  error: Error,
  c: Context<E>,
  securityEvents?: SecurityEventLogger,
) {
  if (error instanceof AppError) {
    if (error.retryAfterSeconds !== undefined) {
      c.header('Retry-After', String(error.retryAfterSeconds))
    }
    if (securityEvents && (error.status === 401 || error.status === 403 || error.status === 429)) {
      emitSecurityEvent(c, securityEvents, {
        code: error.code,
        outcome: error.status === 429 ? 'limited' : 'denied',
        ...(error.securityReason ? { reason: error.securityReason } : {}),
        type: error.status === 401
          ? 'authentication_rejected'
          : error.status === 403
            ? 'authorization_rejected'
            : 'request_rejected',
      })
    }
    return c.json(errorResponse(error.code, error.message, error.details), error.status)
  }

  if (error instanceof ZodError) {
    return c.json(validationErrorResponse(error.issues), 400)
  }

  if (error instanceof HTTPException) {
    return c.json(errorResponse('BAD_REQUEST', error.message), error.status)
  }

  if (securityEvents) {
    emitSecurityEvent(c, securityEvents, {
      code: 'INTERNAL_ERROR',
      outcome: 'failed',
      type: 'exceptional_condition',
    })
  }
  console.error(error)
  return c.json(errorResponse('INTERNAL_ERROR', 'Unexpected server error'), 500)
}
