import { describe, expect, test } from 'bun:test'

import type { RenderedTransactionalMail } from '../application/transactional-mail-ports'
import {
  RegRuSmtpDelivery,
  type SmtpReply,
  type SmtpSession,
} from './reg-ru-smtp-delivery'

describe('RegRuSmtpDelivery', () => {
  test('authenticates only after TLS and returns SMTP acceptance without exposing credentials', async () => {
    const operations: string[] = []
    const replies: SmtpReply[] = [
      reply(220),
      reply(250, ['smtp.example.ru', 'STARTTLS', 'AUTH LOGIN']),
      reply(220),
      reply(250, ['smtp.example.ru', 'AUTH LOGIN']),
      reply(334),
      reply(334),
      reply(235),
      reply(250),
      reply(250),
      reply(354),
      reply(250),
      reply(221),
    ]
    let secure = false
    let establishedConnectionAborted = false
    let closed = false
    const session: SmtpSession = {
      close: () => { closed = true },
      command: async (command, options) => {
        if (command.startsWith('AUTH') || options?.sensitive) {
          expect(secure).toBe(true)
        }
        operations.push(options?.sensitive ? '<redacted>' : command)
        return replies.shift()!
      },
      data: async (content) => {
        operations.push(content)
        return replies.shift()!
      },
      readReply: async () => replies.shift()!,
      upgradeToTls: async () => {
        secure = true
        operations.push('TLS')
      },
    }
    const delivery = new RegRuSmtpDelivery({
      config: {
        from: 'no-reply@anomaly-detector.ru',
        host: 'smtp.example.ru',
        password: 'smtp-password-must-not-leak',
        port: 587,
        replyTo: 'support@anomaly-detector.ru',
        timeoutMs: 10_000,
        tlsMode: 'starttls',
        username: 'no-reply@anomaly-detector.ru',
      },
      sessionFactory: {
        connect: async (_config, signal) => {
          signal.addEventListener('abort', () => {
            establishedConnectionAborted = true
          }, { once: true })
          return session
        },
      },
    })

    const result = await delivery.send(message())

    expect(result).toEqual({ kind: 'accepted' })
    expect(operations.indexOf('TLS')).toBeLessThan(operations.indexOf('AUTH LOGIN'))
    expect(operations.filter((operation) => operation === '<redacted>')).toHaveLength(2)
    expect(operations.at(-2)).toContain('Message-ID: <019f8099-7e26-7760-ad08-66d1d66b2810@anomaly-detector.ru>')
    expect(operations.at(-2)).toContain('Reply-To: support@anomaly-detector.ru')
    expect(JSON.stringify({ operations, result })).not.toContain('smtp-password-must-not-leak')
    expect(establishedConnectionAborted).toBe(false)
    expect(closed).toBe(true)
  })

  test('treats a lost response after DATA as ambiguous without returning provider content', async () => {
    const replies: SmtpReply[] = [
      reply(220),
      reply(250, ['smtp.example.ru', 'AUTH LOGIN']),
      reply(334),
      reply(334),
      reply(235),
      reply(250),
      reply(250),
      reply(354),
    ]
    let closed = false
    const session: SmtpSession = {
      close: () => { closed = true },
      command: async () => replies.shift()!,
      data: async () => { throw new Error('provider response contained recipient data') },
      readReply: async () => replies.shift()!,
      upgradeToTls: async () => undefined,
    }
    const delivery = new RegRuSmtpDelivery({
      config: {
        from: 'no-reply@anomaly-detector.ru',
        host: 'smtp.example.ru',
        password: 'smtp-password-must-not-leak',
        port: 465,
        replyTo: 'support@anomaly-detector.ru',
        timeoutMs: 10_000,
        tlsMode: 'implicit_tls',
        username: 'no-reply@anomaly-detector.ru',
      },
      sessionFactory: { connect: async () => session },
    })

    const result = await delivery.send(message())

    expect(result).toEqual({
      ambiguous: true,
      code: 'smtp_response_lost',
      kind: 'temporary_failure',
    })
    expect(JSON.stringify(result)).not.toMatch(/recipient|password|provider response/i)
    expect(closed).toBe(true)
  })

  test('bounds the complete SMTP attempt and closes a stalled session', async () => {
    let closed = false
    let establishedConnectionAborted = false
    const session: SmtpSession = {
      close: () => { closed = true },
      command: async () => reply(250),
      data: async () => reply(250),
      readReply: async () => new Promise(() => undefined),
      upgradeToTls: async () => undefined,
    }
    const delivery = new RegRuSmtpDelivery({
      config: {
        from: 'no-reply@anomaly-detector.ru',
        host: 'smtp.example.ru',
        password: 'smtp-password-must-not-leak',
        port: 465,
        replyTo: 'support@anomaly-detector.ru',
        timeoutMs: 1_000,
        tlsMode: 'implicit_tls',
        username: 'no-reply@anomaly-detector.ru',
      },
      sessionFactory: {
        connect: async (_config, signal) => {
          signal.addEventListener('abort', () => {
            establishedConnectionAborted = true
          }, { once: true })
          return session
        },
      },
    })
    const startedAt = performance.now()

    const result = await delivery.send(message())

    expect(result).toEqual({
      ambiguous: false,
      code: 'smtp_timeout',
      kind: 'temporary_failure',
    })
    expect(performance.now() - startedAt).toBeLessThan(1_500)
    expect(establishedConnectionAborted).toBe(false)
    expect(closed).toBe(true)
  })

  test('aborts a connection that has not produced a session before the deadline', async () => {
    let aborted = false
    const delivery = new RegRuSmtpDelivery({
      config: {
        from: 'no-reply@anomaly-detector.ru',
        host: 'smtp.example.ru',
        password: 'smtp-password-must-not-leak',
        port: 465,
        replyTo: 'support@anomaly-detector.ru',
        timeoutMs: 1_000,
        tlsMode: 'implicit_tls',
        username: 'no-reply@anomaly-detector.ru',
      },
      sessionFactory: {
        connect: async (_config, signal: AbortSignal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('connection aborted'))
          }, { once: true })
        }),
      },
    })

    const result = await delivery.send(message())

    expect(result).toEqual({
      ambiguous: false,
      code: 'smtp_timeout',
      kind: 'temporary_failure',
    })
    expect(aborted).toBe(true)
  })
})

function reply(code: number, lines: string[] = []): SmtpReply {
  return { code, lines }
}

function message(): RenderedTransactionalMail {
  return {
    createdAt: new Date('2026-08-22T12:00:00.000Z'),
    messageId: '<019f8099-7e26-7760-ad08-66d1d66b2810@anomaly-detector.ru>',
    recipient: 'researcher@yandex.ru',
    subject: 'Подтверждение почты — Anomaly Detector',
    text: 'Код подтверждения:\n\n482193',
  }
}
