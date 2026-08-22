import { createHmac } from 'node:crypto'

import { z } from 'zod'

const secretSchema = z.string().min(32)
const messageIdSchema = z.string().uuid()

export function deriveAccountEmailConfirmationCode(secret: string, messageId: string) {
  const key = secretSchema.parse(secret)
  const identity = messageIdSchema.parse(messageId)
  const digest = createHmac('sha256', key)
    .update('account-email-confirmation-v1\0')
    .update(identity)
    .digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
