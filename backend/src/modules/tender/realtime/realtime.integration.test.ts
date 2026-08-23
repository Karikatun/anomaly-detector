import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../../app'
import { createPrisma } from '../../../db'
import type { AppEnv } from '../../../env'
import { createTenderModule } from '../index'
import { createPrismaTenderStore } from '../infrastructure/prisma-tender-store'
import { createRealtimeHub, type RealtimeHub } from './hub'
import { createPrismaRealtimeTicketStore } from './prisma-realtime-ticket-store'
import {
  createRealtimeWebSocketHandlers,
  upgradeRealtimeWebSocket,
  type RealtimeSocketData,
} from './websocket'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('realtime websocket integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    ADMIN_USER_IDS: [],
    ANALYTICS_ENABLED: false,
    ANALYTICS_ORIGINS: [],
    ANALYTICS_CAMPAIGN_ALLOWLIST: [],
    CORS_ORIGINS: ['http://localhost:5173'],
    WEBAPP_ORIGIN: 'http://localhost:5173',
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: false,
    COOKIE_SECURE: false,
    MAIL_SMTP_ENABLED: false,
    MAIL_SMTP_TIMEOUT_MS: 10_000,
    MAIL_SMTP_MAX_ATTEMPTS: 5,
    MAIL_SMTP_RETRY_BASE_SECONDS: 30,
    MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD: 5,
    MAIL_SMTP_CIRCUIT_OPEN_SECONDS: 300,
    MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE: 60,
    MAIL_SMTP_LEASE_SECONDS: 60,
    MAIL_SMTP_WORKER_INTERVAL_MS: 1_000,
    MAIL_OUTBOX_RETENTION_DAYS: 30,
    YANDEX_STORAGE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS: 900,
    YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS: 300,
    YANDEX_STORAGE_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  }
  const prisma = createPrisma(databaseUrl!)
  const ticketStore = createPrismaRealtimeTicketStore(prisma, {
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
  })

  let realtime: RealtimeHub
  const tender = createTenderModule({
    onTenderChanged: (tenderId) => {
      void realtime?.handleTenderChanged(tenderId)
    },
    store: createPrismaTenderStore(prisma),
  })
  realtime = createRealtimeHub({ tender })
  const app = createApp({ env, prisma, tender })

  const server = Bun.serve<RealtimeSocketData>({
    port: 0,
    fetch(request, bunServer) {
      const url = new URL(request.url)
      if (url.pathname === '/api/realtime/ws') {
        return upgradeRealtimeWebSocket({ hub: realtime, request, server: bunServer, ticketStore })
      }
      return app.fetch(request)
    },
    websocket: createRealtimeWebSocketHandlers({ hub: realtime }),
  })
  const baseUrl = `http://127.0.0.1:${server.port}`
  const wsPath = '/api/realtime/ws'
  const wsUrl = `ws://127.0.0.1:${server.port}${wsPath}`

  const register = async (login: string) => {
    const response = await fetch(`${baseUrl}/api/auth/token/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsAccepted: true,
        termsVersion: '1.0',
      }),
    })
    expect(response.status).toBe(201)
    return response.json() as Promise<{
      accessToken: string
      refreshToken: string
      user: { id: string }
    }>
  }

  const issueTicket = async (accessToken: string) => {
    const response = await fetch(`${baseUrl}/api/realtime/tickets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(response.status).toBe(201)
    return (await response.json()) as { ticket: string }
  }

  const connect = (url: string) => new Promise<{ messages: unknown[]; socket: WebSocket }>((resolve, reject) => {
    const messages: unknown[] = []
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), 5_000)
    socket.onmessage = (event) => { messages.push(JSON.parse(String(event.data))) }
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket error')) }
    socket.onopen = () => {
      clearTimeout(timeout)
      resolve({ messages, socket })
    }
  })

  const nextMessage = (messages: unknown[], count: number) => new Promise<unknown>((resolve, reject) => {
    const startedAt = Date.now()
    const poll = () => {
      if (messages.length > count) {
        resolve(messages[count])
        return
      }
      if (Date.now() - startedAt > 5_000) {
        reject(new Error(`Timed out waiting for message ${count + 1}; received ${messages.length}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })

  const observeRejectedConnection = (url: string) => new Promise<{
    code: number
    messages: unknown[]
    reason: string
  }>((resolve, reject) => {
    const messages: unknown[] = []
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Rejected WebSocket did not close'))
    }, 5_000)
    socket.onmessage = (event) => { messages.push(JSON.parse(String(event.data))) }
    socket.onclose = (event) => {
      clearTimeout(timeout)
      resolve({ code: event.code, messages, reason: event.reason })
    }
  })

  beforeEach(async () => {
    await prisma.tenderRoomMember.deleteMany()
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.realtimeTicket.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    server.stop(true)
    await prisma.$disconnect()
  })

  test('streams participant-scoped tender views and burns one-time tickets', async () => {
    const host = await register('ws-host')
    const joiner = await register('ws-joiner')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: joiner.user.id, tiePriority: 2 },
      ],
    })

    const hostTicket = await issueTicket(host.accessToken)
    const joinerTicket = await issueTicket(joiner.accessToken)

    const hostSocket = await connect(`${wsUrl}?ticket=${hostTicket.ticket}&tenderId=${tenderId}`)
    const joinerSocket = await connect(`${wsUrl}?ticket=${joinerTicket.ticket}&tenderId=${tenderId}`)

    const hostGreeting = await nextMessage(hostSocket.messages, 0) as {
      type: string
      view: { phase: string; tenderId: string; players: Array<{ playerId: string }> }
    }
    expect(hostGreeting.type).toBe('tender-view')
    expect(hostGreeting.view.tenderId).toBe(tenderId)
    expect(hostGreeting.view.phase).toBe('access-slot-selection')
    expect(hostGreeting.view.players.map((player) => player.playerId).sort())
      .toEqual([host.user.id, joiner.user.id].sort())
    expect(await nextMessage(joinerSocket.messages, 0)).toMatchObject({ type: 'tender-view' })

    const command = await fetch(`${baseUrl}/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: host.user.id,
        commandId: 'ws-command-1',
        slot: 4,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(command.status).toBe(200)

    const hostUpdate = await nextMessage(hostSocket.messages, 1) as {
      view: { players: Array<{ playerId: string; requestedAccessSlot?: number }> }
    }
    const joinerUpdate = await nextMessage(joinerSocket.messages, 1) as {
      view: { players: Array<{ playerId: string; requestedAccessSlot?: number }> }
    }
    const hostSeesSelf = hostUpdate.view.players.find((player) => player.playerId === host.user.id)
    const joinerSeesHost = joinerUpdate.view.players.find((player) => player.playerId === host.user.id)
    expect(hostSeesSelf?.requestedAccessSlot).toBe(4)
    expect(joinerSeesHost?.requestedAccessSlot).toBeUndefined()

    hostSocket.socket.close()
    joinerSocket.socket.close()

    const replay = await fetch(`${baseUrl}${wsPath}?ticket=${hostTicket.ticket}&tenderId=${tenderId}`)
    expect(replay.status).toBe(401)
  }, 15_000)

  test('rejects unknown tickets at the upgrade boundary', async () => {
    const response = await fetch(`${baseUrl}${wsPath}?ticket=${'x'.repeat(64)}&tenderId=00000000-0000-0000-0000-000000000000`)
    expect(response.status).toBe(401)
  })

  test('rejects malformed Tender ids without consuming the one-time ticket', async () => {
    const host = await register('ws-malformed-tender')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)

    const malformed = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=not-a-uuid`)
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid Tender id' },
    })

    const connection = await connect(`${wsUrl}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(await nextMessage(connection.messages, 0)).toMatchObject({ type: 'tender-view' })
    connection.socket.close()
  })

  test('closes foreign and missing Tender subscriptions identically without sending a view', async () => {
    const host = await register('ws-foreign-host')
    const outsider = await register('ws-foreign-outsider')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })

    const foreignTicket = await issueTicket(outsider.accessToken)
    const foreign = await observeRejectedConnection(
      `${wsUrl}?ticket=${foreignTicket.ticket}&tenderId=${tenderId}`,
    )
    const missingTicket = await issueTicket(outsider.accessToken)
    const missing = await observeRejectedConnection(
      `${wsUrl}?ticket=${missingTicket.ticket}&tenderId=${crypto.randomUUID()}`,
    )

    expect(foreign).toEqual({ code: 4403, messages: [], reason: 'Forbidden' })
    expect(missing).toEqual(foreign)
  })

  test('rejects a ticket after its authenticated session is revoked', async () => {
    const host = await register('ws-revoked-session')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)

    const logout = await fetch(`${baseUrl}/api/auth/token/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: host.refreshToken }),
    })
    expect(logout.status).toBe(204)

    const response = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(response.status).toBe(401)
  })

  test('rejects a ticket after its authenticated session expires', async () => {
    const host = await register('ws-expired-session')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)
    await prisma.authSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { userId: host.user.id },
    })

    const response = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(response.status).toBe(401)
  })

  test('rejects an expired one-time ticket at the upgrade boundary', async () => {
    const host = await register('ws-expired-ticket')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)
    await prisma.realtimeTicket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { userId: host.user.id },
    })

    const response = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(response.status).toBe(401)
  })

  test('rejects a ticket after its authenticated session reaches its absolute lifetime', async () => {
    const host = await register('ws-absolute-session')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)
    await prisma.authSession.updateMany({
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 1) * 1_000,
        ),
      },
      where: { userId: host.user.id },
    })

    const response = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(response.status).toBe(401)
  })

  test('rejects a ticket whose stored user and session identities diverge', async () => {
    const host = await register('ws-ticket-owner')
    const other = await register('ws-other-session')
    const { tenderId } = await tender.createTender({
      players: [
        { id: host.user.id, tiePriority: 1 },
        { id: crypto.randomUUID(), tiePriority: 2 },
      ],
    })
    const ticket = await issueTicket(host.accessToken)
    const otherSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: other.user.id },
    })
    await prisma.realtimeTicket.updateMany({
      data: { sessionId: otherSession.id },
      where: { userId: host.user.id },
    })

    const response = await fetch(`${baseUrl}${wsPath}?ticket=${ticket.ticket}&tenderId=${tenderId}`)
    expect(response.status).toBe(401)
  })
})
