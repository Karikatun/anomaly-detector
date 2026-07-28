import type { Context, Env, MiddlewareHandler } from 'hono'

export type SecurityEvent = {
  code: string
  method: string
  occurredAt: string
  outcome: 'denied' | 'failed' | 'limited'
  path: string
  reason?: string
  requestId: string
  type:
    | 'authentication_rejected'
    | 'authorization_rejected'
    | 'exceptional_condition'
    | 'request_rejected'
}

export type SecurityEventLogger = {
  emit(event: SecurityEvent): void
}

export type SecurityHttpEnv = {
  Variables: {
    securityRequestId: string
  }
}

export const consoleSecurityEventLogger: SecurityEventLogger = {
  emit(event) {
    console.warn(JSON.stringify({ channel: 'security', ...event }))
  },
}

export function createSecurityRequestContext(): MiddlewareHandler<SecurityHttpEnv> {
  return async (c, next) => {
    const requestId = crypto.randomUUID()
    c.set('securityRequestId', requestId)
    c.header('X-Request-Id', requestId)
    await next()
  }
}

export function emitSecurityEvent<
  E extends Env & { Variables: { securityRequestId: string } },
>(
  c: Context<E>,
  logger: SecurityEventLogger,
  event: Pick<SecurityEvent, 'code' | 'outcome' | 'reason' | 'type'>,
) {
  try {
    logger.emit({
      ...event,
      method: c.req.method,
      occurredAt: new Date().toISOString(),
      path: c.req.path,
      requestId: c.get('securityRequestId') ?? 'unavailable',
    })
  } catch {
    // Security telemetry must never change the request outcome.
  }
}
