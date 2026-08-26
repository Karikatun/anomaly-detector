import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'

import { z } from 'zod'

import type {
  RenderedTransactionalMail,
  TransactionalMailDelivery,
  TransactionalMailDeliveryResult,
} from '../application/transactional-mail-ports'

export type RegRuSmtpConfig = {
  from: string
  host: string
  password: string
  port: number
  replyTo: string
  timeoutMs: number
  tlsMode: 'implicit_tls' | 'starttls'
  username: string
}

export type SmtpReply = {
  code: number
  lines: string[]
}

export type SmtpSession = {
  close(): void
  command(command: string, options?: { sensitive?: boolean }): Promise<SmtpReply>
  data(content: string): Promise<SmtpReply>
  readReply(): Promise<SmtpReply>
  upgradeToTls(servername: string): Promise<void>
}

export type SmtpSessionFactory = {
  connect(
    config: Pick<RegRuSmtpConfig, 'host' | 'port' | 'timeoutMs' | 'tlsMode'>,
    signal: AbortSignal,
  ): Promise<SmtpSession>
}

const smtpConfigSchema = z.object({
  from: z.literal('no-reply@anomaly-detector.ru'),
  host: z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i),
  password: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  replyTo: z.literal('support@anomaly-detector.ru'),
  timeoutMs: z.number().int().min(1_000).max(60_000),
  tlsMode: z.enum(['implicit_tls', 'starttls']),
  username: z.literal('no-reply@anomaly-detector.ru'),
}).strict()

const renderedMessageSchema = z.object({
  createdAt: z.date(),
  messageId: z.string().regex(/^<[0-9a-f-]{36}@anomaly-detector\.ru>$/),
  recipient: z.string().min(3).max(254).regex(/^[^\s\r\n@]+@[^\s\r\n@]+$/),
  subject: z.string().min(1).max(200).refine((value) => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(100_000).refine((value) => !value.includes('\u0000')),
}).strict()

export class RegRuSmtpDelivery implements TransactionalMailDelivery {
  private readonly config: RegRuSmtpConfig
  private readonly sessionFactory: SmtpSessionFactory

  constructor(input: {
    config: RegRuSmtpConfig
    sessionFactory?: SmtpSessionFactory
  }) {
    this.config = smtpConfigSchema.parse(input.config)
    this.sessionFactory = input.sessionFactory ?? nodeSmtpSessionFactory
  }

  async send(rawMessage: RenderedTransactionalMail): Promise<TransactionalMailDeliveryResult> {
    const message = renderedMessageSchema.parse(rawMessage)
    const abortController = new AbortController()
    let session: SmtpSession | undefined
    let dataStarted = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const attempt = (async (): Promise<TransactionalMailDeliveryResult> => {
        session = await this.sessionFactory.connect(this.config, abortController.signal)
        requireReply(await session.readReply(), 220, 'greeting')

        let capabilities = requireReply(
          await session.command('EHLO anomaly-detector.ru'),
          250,
          'ehlo',
        ).lines
        if (this.config.tlsMode === 'starttls') {
          if (!capabilities.some((line) => line.toUpperCase().includes('STARTTLS'))) {
            throw new SmtpDeliveryFailure('smtp_starttls_unavailable', false, true)
          }
          requireReply(await session.command('STARTTLS'), 220, 'starttls')
          await session.upgradeToTls(this.config.host)
          capabilities = requireReply(
            await session.command('EHLO anomaly-detector.ru'),
            250,
            'ehlo',
          ).lines
        }
        if (!capabilities.some((line) => line.toUpperCase().includes('AUTH'))) {
          throw new SmtpDeliveryFailure('smtp_auth_unavailable', false, true)
        }

        requireReply(await session.command('AUTH LOGIN'), 334, 'auth')
        requireReply(await session.command(
          Buffer.from(this.config.username).toString('base64'),
          { sensitive: true },
        ), 334, 'auth')
        requireReply(await session.command(
          Buffer.from(this.config.password).toString('base64'),
          { sensitive: true },
        ), 235, 'auth')
        requireReply(await session.command(`MAIL FROM:<${this.config.from}>`), 250, 'mail_from')
        requireReply(await session.command(`RCPT TO:<${message.recipient}>`), 250, 'recipient')
        requireReply(await session.command('DATA'), 354, 'data')
        dataStarted = true
        requireReply(await session.data(renderData(message, this.config)), 250, 'message', true)
        void session.command('QUIT').catch(() => undefined)
        return { kind: 'accepted' }
      })()
      const boundedAttempt = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new SmtpDeliveryFailure(
            dataStarted ? 'smtp_response_lost' : 'smtp_timeout',
            dataStarted,
            true,
          ))
          if (session) session.close()
          else abortController.abort()
        }, this.config.timeoutMs)
      })
      return await Promise.race([attempt, boundedAttempt])
    } catch (error) {
      if (error instanceof SmtpDeliveryFailure) {
        return error.temporary
          ? { ambiguous: error.ambiguous, code: error.code, kind: 'temporary_failure' }
          : { code: error.code, kind: 'terminal_failure' }
      }
      return {
        ambiguous: dataStarted,
        code: dataStarted ? 'smtp_response_lost' : 'smtp_connection_failed',
        kind: 'temporary_failure',
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      if (!session) abortController.abort()
      session?.close()
    }
  }
}

class SmtpDeliveryFailure extends Error {
  constructor(
    readonly code: string,
    readonly ambiguous: boolean,
    readonly temporary: boolean,
  ) {
    super(code)
  }
}

function requireReply(
  reply: SmtpReply,
  expected: number,
  stage: 'auth' | 'data' | 'ehlo' | 'greeting' | 'mail_from' | 'message' | 'recipient' | 'starttls',
  ambiguous = false,
) {
  if (reply.code === expected) return reply
  if (reply.code >= 400 && reply.code < 500) {
    throw new SmtpDeliveryFailure(`smtp_${stage}_temporary`, ambiguous, true)
  }
  if (stage === 'recipient') {
    throw new SmtpDeliveryFailure('smtp_recipient_rejected', false, false)
  }
  if (stage === 'message') {
    throw new SmtpDeliveryFailure('smtp_message_rejected', true, false)
  }
  throw new SmtpDeliveryFailure(`smtp_${stage}_rejected`, ambiguous, true)
}

function renderData(message: z.infer<typeof renderedMessageSchema>, config: RegRuSmtpConfig) {
  const headers = [
    `Date: ${message.createdAt.toUTCString()}`,
    `From: Anomaly Detector <${config.from}>`,
    `To: <${message.recipient}>`,
    `Reply-To: ${config.replyTo}`,
    `Message-ID: ${message.messageId}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  const encodedBody = Buffer.from(message.text).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''
  return `${headers.join('\r\n')}\r\n\r\n${encodedBody}`
}

const nodeSmtpSessionFactory: SmtpSessionFactory = {
  async connect(config, signal) {
    const socket = config.tlsMode === 'implicit_tls'
      ? await connectTlsSocket(config, signal)
      : await connectTcpSocket(config, signal)
    return new NodeSmtpSession(socket, config.timeoutMs)
  },
}

type TransportSocket = Socket | TLSSocket

class NodeSmtpSession implements SmtpSession {
  private buffer = ''

  constructor(
    private socket: TransportSocket,
    private readonly timeoutMs: number,
  ) {}

  close() {
    this.socket.destroy()
  }

  async command(command: string): Promise<SmtpReply> {
    if (/[\r\n]/.test(command)) throw new Error('Invalid SMTP command')
    await this.write(`${command}\r\n`)
    return this.readReply()
  }

  async data(content: string): Promise<SmtpReply> {
    const normalized = content.replace(/\r?\n/g, '\r\n')
    const dotStuffed = normalized
      .split('\r\n')
      .map((line) => line.startsWith('.') ? `.${line}` : line)
      .join('\r\n')
    await this.write(`${dotStuffed}\r\n.\r\n`)
    return this.readReply()
  }

  async readReply(): Promise<SmtpReply> {
    const immediate = takeReply(this.buffer)
    if (immediate) {
      this.buffer = immediate.rest
      return immediate.reply
    }
    return new Promise<SmtpReply>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('data', onData)
        this.socket.off('error', onError)
        this.socket.off('close', onClose)
        this.socket.off('timeout', onTimeout)
        this.socket.setTimeout(0)
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onData = (chunk: Buffer | string) => {
        this.buffer += chunk.toString()
        if (this.buffer.length > 65_536) {
          fail(new Error('SMTP reply exceeded limit'))
          return
        }
        const parsed = takeReply(this.buffer)
        if (!parsed) return
        this.buffer = parsed.rest
        cleanup()
        resolve(parsed.reply)
      }
      const onError = () => fail(new Error('SMTP socket failed'))
      const onClose = () => fail(new Error('SMTP socket closed'))
      const onTimeout = () => fail(new Error('SMTP socket timed out'))
      this.socket.on('data', onData)
      this.socket.once('error', onError)
      this.socket.once('close', onClose)
      this.socket.once('timeout', onTimeout)
      this.socket.setTimeout(this.timeoutMs)
    })
  }

  async upgradeToTls(servername: string) {
    const socket = this.socket
    this.socket = await new Promise<TLSSocket>((resolve, reject) => {
      const tlsSocket = connectTls({
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        servername,
        socket,
      })
      const onError = () => {
        tlsSocket.destroy()
        reject(new Error('SMTP TLS upgrade failed'))
      }
      tlsSocket.once('error', onError)
      tlsSocket.once('secureConnect', () => {
        tlsSocket.off('error', onError)
        resolve(tlsSocket)
      })
    })
  }

  private async write(value: string) {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(value, (error) => {
        if (error) reject(new Error('SMTP write failed'))
        else resolve()
      })
    })
  }
}

function connectTcpSocket(
  config: Pick<RegRuSmtpConfig, 'host' | 'port' | 'timeoutMs'>,
  signal: AbortSignal,
) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connectTcp({ host: config.host, port: config.port, signal })
    const onError = () => {
      socket.destroy()
      reject(new Error('SMTP connection failed'))
    }
    socket.once('error', onError)
    socket.setTimeout(config.timeoutMs, () => {
      socket.destroy()
      reject(new Error('SMTP connection timed out'))
    })
    socket.once('connect', () => {
      socket.off('error', onError)
      socket.setTimeout(0)
      resolve(socket)
    })
  })
}

function connectTlsSocket(
  config: Pick<RegRuSmtpConfig, 'host' | 'port' | 'timeoutMs'>,
  signal: AbortSignal,
) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = connectTls({
      host: config.host,
      minVersion: 'TLSv1.2',
      port: config.port,
      rejectUnauthorized: true,
      servername: config.host,
      signal,
    })
    const onError = () => {
      socket.destroy()
      reject(new Error('SMTP TLS connection failed'))
    }
    socket.once('error', onError)
    socket.setTimeout(config.timeoutMs, () => {
      socket.destroy()
      reject(new Error('SMTP TLS connection timed out'))
    })
    socket.once('secureConnect', () => {
      socket.off('error', onError)
      socket.setTimeout(0)
      resolve(socket)
    })
  })
}

function takeReply(buffer: string): { reply: SmtpReply; rest: string } | null {
  const completeLines = buffer.split('\r\n')
  if (completeLines.at(-1) !== '') completeLines.pop()
  const first = completeLines[0]?.match(/^(\d{3})([ -])(.*)$/)
  if (!first) return null
  const code = Number(first[1])
  let lastIndex = first[2] === ' ' ? 0 : -1
  if (lastIndex === -1) {
    lastIndex = completeLines.findIndex((line, index) => index > 0 && line.startsWith(`${code} `))
  }
  if (lastIndex === -1) return null
  const consumed = completeLines.slice(0, lastIndex + 1).join('\r\n').length + 2
  return {
    reply: {
      code,
      lines: completeLines.slice(0, lastIndex + 1).map((line) => line.slice(4)),
    },
    rest: buffer.slice(consumed),
  }
}
