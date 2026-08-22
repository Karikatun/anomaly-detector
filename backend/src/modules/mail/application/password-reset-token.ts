import { createHmac } from 'node:crypto'

import { z } from 'zod'

const secretSchema = z.string().min(32)
const messageIdSchema = z.string().uuid()

export function derivePasswordResetToken(secret: string, messageId: string) {
  return createHmac('sha256', secretSchema.parse(secret))
    .update('password-reset-token-v1\0')
    .update(messageIdSchema.parse(messageId))
    .digest('base64url')
}

export function isSafePasswordRecoveryBaseUrl(value: string) {
  const url = new URL(value)
  const secureTransport = url.protocol === 'https:'
    || (url.protocol === 'http:'
      && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
  return secureTransport
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
}
