import type { ApiErrorCode, ApiErrorResponse } from '@web-app-demo/contracts'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
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

export function handleError(error: Error, c: Context) {
  if (error instanceof AppError) {
    return c.json(errorResponse(error.code, error.message, error.details), error.status)
  }

  if (error instanceof ZodError) {
    return c.json(errorResponse('VALIDATION_ERROR', 'Invalid request payload', error.issues), 400)
  }

  if (error instanceof HTTPException) {
    return c.json(errorResponse('BAD_REQUEST', error.message), error.status)
  }

  console.error(error)
  return c.json(errorResponse('INTERNAL_ERROR', 'Unexpected server error'), 500)
}
