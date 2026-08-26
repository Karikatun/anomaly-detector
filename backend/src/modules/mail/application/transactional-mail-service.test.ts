import { describe, expect, test } from 'bun:test'

import {
  TransactionalMailFailure,
  TransactionalMailService,
} from './transactional-mail-service'
import { deriveAccountEmailConfirmationCode } from './account-email-confirmation-code'
import type { TransactionalMailWriter } from './transactional-mail-ports'

describe('TransactionalMailService', () => {
  test('queues one approved transactional template and replays the same logical message', async () => {
    const writes: Array<{ fingerprint: string; messageId: string; recipientDomain: string }> = []
    const writer: TransactionalMailWriter = {
      enqueue: async (input) => {
        const existing = writes.find((write) => write.messageId === input.messageId)
        if (existing) return { fingerprint: existing.fingerprint, kind: 'exists' }
        writes.push({
          fingerprint: input.fingerprint,
          messageId: input.messageId,
          recipientDomain: input.recipientDomain,
        })
        return { kind: 'inserted' }
      },
    }
    const service = new TransactionalMailService(
      writer,
      'mail-fingerprint-primary-key-0001',
    )
    const request = {
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2801',
      recipient: 'researcher@yandex.ru',
      template: {
        expiresAt: new Date('2026-08-22T12:15:00.000Z'),
        kind: 'account_email_confirmation' as const,
      },
    }

    await expect(service.enqueue(request)).resolves.toEqual({
      kind: 'queued',
      messageId: request.messageId,
    })
    await expect(service.enqueue(request)).resolves.toEqual({
      kind: 'already_queued',
      messageId: request.messageId,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].recipientDomain).toBe('yandex.ru')

    let rotatedFingerprint = ''
    const rotatedService = new TransactionalMailService({
      enqueue: async (input) => {
        rotatedFingerprint = input.fingerprint
        return { kind: 'inserted' }
      },
    }, 'mail-fingerprint-rotated-key-0002')
    await rotatedService.enqueue(request)
    expect(rotatedFingerprint).not.toBe(writes[0].fingerprint)

    await expect(service.enqueue({
      ...request,
      recipient: 'other@yandex.ru',
    })).rejects.toMatchObject({
      kind: 'message_conflict',
    } satisfies Partial<TransactionalMailFailure>)
  })

  test('derives a bounded confirmation code without storing the credential', () => {
    const secret = 'mail-confirmation-code-key-0000001'
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2801'
    const code = deriveAccountEmailConfirmationCode(secret, messageId)

    expect(code).toMatch(/^\d{6}$/)
    expect(deriveAccountEmailConfirmationCode(secret, messageId)).toBe(code)
    expect(deriveAccountEmailConfirmationCode(secret, '019f8099-7e26-7760-ad08-66d1d66b2802'))
      .not.toBe(code)
  })

  test('rejects unsupported mail purposes and insecure recovery links', async () => {
    const service = new TransactionalMailService(
      {
        enqueue: async () => {
          throw new Error('invalid requests must not reach persistence')
        },
      },
      'mail-fingerprint-primary-key-0001',
    )
    await expect(service.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2802',
      recipient: 'researcher@yandex.ru',
      template: { kind: 'marketing', text: 'promo' },
    } as never)).rejects.toMatchObject({ kind: 'invalid_request' })
    await expect(service.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2803',
      recipient: 'researcher@yandex.ru',
      template: {
        expiresAt: new Date('2026-08-22T12:15:00.000Z'),
        kind: 'password_recovery',
        recoveryUrl: 'http://example.com/reset?token=secret',
      },
    })).rejects.toMatchObject({ kind: 'invalid_request' })
  })

  test('permits a token-free loopback recovery route only for local development', async () => {
    const service = new TransactionalMailService(
      { enqueue: async () => ({ kind: 'inserted' }) },
      'mail-fingerprint-primary-key-0001',
    )
    await expect(service.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2804',
      recipient: 'researcher@yandex.ru',
      template: {
        expiresAt: new Date('2026-08-22T12:15:00.000Z'),
        kind: 'password_recovery',
        recoveryUrl: 'http://127.0.0.1:5173/recover/password',
      },
    })).resolves.toMatchObject({ kind: 'queued' })
    await expect(service.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2805',
      recipient: 'researcher@yandex.ru',
      template: {
        expiresAt: new Date('2026-08-22T12:15:00.000Z'),
        kind: 'password_recovery',
        recoveryUrl: 'http://127.0.0.1:5173/recover/password#token=secret',
      },
    })).rejects.toMatchObject({ kind: 'invalid_request' })
  })
})
