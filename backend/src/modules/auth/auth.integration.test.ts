import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'
import { createRoomStartModule } from '../room'
import { createPersistentTenderModule } from '../tender'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('auth API integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 1_000,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: true,
    TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-test-client-ip',
    COOKIE_SECURE: false,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  }
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.authAbuseBucket.deleteMany()
    await prisma.tenderRoomMember.deleteMany()
    await prisma.tenderRoom.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('registers, reads me, refreshes, and logs out', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login: 'user',
        password: 'password123',
        displayName: 'User',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registerBody = await register.json()

    expect(register.status).toBe(201)
    expect(registerBody.user.login).toBe('user')
    expect(registerBody.accessToken).toBeString()
    expect(registerBody.refreshToken).toBeString()
    expect(register.headers.get('set-cookie')).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({
      where: { login: 'user' },
      select: {
        privacyConsentAt: true,
        privacyConsentVersion: true,
        termsAcceptedAt: true,
        termsVersion: true,
      },
    })).toEqual({
      privacyConsentAt: expect.any(Date),
      privacyConsentVersion: '1.0',
      termsAcceptedAt: expect.any(Date),
      termsVersion: '1.0',
    })

    const me = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(me.status).toBe(200)
    const meBody = await me.json()
    expect(meBody).toEqual({ user: registerBody.user })
    expect('sessionId' in meBody.user).toBe(false)

    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const refreshBody = await refresh.json()
    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeString()
    expect(refreshBody.refreshToken).not.toBe(registerBody.refreshToken)
    expect(refresh.headers.get('set-cookie')).toBeNull()

    const meWithPreRefreshAccessToken = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(meWithPreRefreshAccessToken.status).toBe(200)

    const sessionsAfterRefresh = await prisma.authSession.count({
      where: {
        user: {
          login: 'user',
        },
      },
    })
    expect(sessionsAfterRefresh).toBe(1)

    const staleRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const staleRefreshBody = await staleRefresh.json()
    expect(staleRefresh.status).toBe(200)
    expect(staleRefreshBody.refreshToken).toBeString()

    const logout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(logout.status).toBe(204)

    const revokedRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(revokedRefresh.status).toBe(401)
  })

  test('issues a short-lived realtime ticket for an authenticated session', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'ticket',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken } = await register.json()

    const ticket = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    expect(ticket.status).toBe(201)
    expect(await ticket.json()).toMatchObject({
      expiresAt: expect.any(String),
      ticket: expect.any(String),
    })
  })

  test('creates a private room and lets another authenticated player join it', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken, user } = await register.json()

    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })

    expect(createRoom.status).toBe(201)
    const room = await createRoom.json()
    expect(room).toEqual({
      capacity: 2,
      hostId: user.id,
      joinCode: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{10}$/),
      roomId: expect.any(String),
      members: [{ displayName: user.displayName ?? 'Исследователь', ready: false, seat: 1, userId: user.id }],
      serverTime: expect.any(String),
      status: 'waiting',
    })

    const joinerRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-joiner',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const joiner = await joinerRegister.json()
    const join = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: ` ${room.joinCode.toLowerCase()} ` }),
    })

    expect(join.status).toBe(200)
    expect(await join.json()).toMatchObject({
      members: [
        { ready: false, seat: 1, userId: user.id },
        { ready: false, seat: 2, userId: joiner.user.id },
      ],
      roomId: room.roomId,
    })

    const readRoom = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(readRoom.status).toBe(200)
    expect(await readRoom.json()).toMatchObject({
      members: [
        { userId: user.id },
        { userId: joiner.user.id },
      ],
      roomId: room.roomId,
    })

    const extraRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-extra',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const extra = await extraRegister.json()
    const expectRoomHiddenFromExtra = async () => {
      const existingRoom = await app.request(`/api/rooms/${room.roomId}`, {
        headers: { Authorization: `Bearer ${extra.accessToken}` },
      })
      const absentRoom = await app.request('/api/rooms/019f8099-7e26-7760-ad08-66d1d66b2719', {
        headers: { Authorization: `Bearer ${extra.accessToken}` },
      })

      expect(existingRoom.status).toBe(404)
      expect(await existingRoom.json()).toEqual(await absentRoom.json())
    }
    await expectRoomHiddenFromExtra()

    const fullRoomJoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${extra.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })

    expect(fullRoomJoin.status).toBe(409)
    expect(await fullRoomJoin.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const leave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(leave.status).toBe(204)

    const rejoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    expect(rejoin.status).toBe(200)
    expect(await rejoin.json()).toMatchObject({
      members: [{ seat: 1, userId: user.id }, { seat: 2, userId: joiner.user.id }],
      roomId: room.roomId,
    })

    const nonHostStart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(nonHostStart.status).toBe(404)

    const unreadyStart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(unreadyStart.status).toBe(409)

    const hostReady = await app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect(hostReady.status).toBe(200)
    expect(await hostReady.json()).toMatchObject({
      members: [
        { ready: true, userId: user.id },
        { ready: false, userId: joiner.user.id },
      ],
    })

    const joinerReady = await app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect(joinerReady.status).toBe(200)
    expect(await joinerReady.json()).toMatchObject({
      members: [
        { ready: true, userId: user.id },
        { ready: true, userId: joiner.user.id },
      ],
    })

    const start = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(start.status).toBe(200)
    const scheduledRoom = await start.json()
    expect(scheduledRoom).toMatchObject({
      roomId: room.roomId,
      serverTime: expect.any(String),
      status: 'starting',
      startsAt: expect.any(String),
    })
    expect(scheduledRoom.tenderId).toBeUndefined()
    const startingRoomForMember = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(startingRoomForMember.status).toBe(200)
    expect(await startingRoomForMember.json()).toMatchObject({ status: 'starting' })
    await expectRoomHiddenFromExtra()

    const cancelStart = await app.request(`/api/rooms/${room.roomId}/cancel-start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(cancelStart.status).toBe(200)
    const cancelledRoom = await cancelStart.json()
    expect(cancelledRoom.roomId).toBe(room.roomId)
    expect(cancelledRoom.status).toBe('waiting')
    expect('startsAt' in cancelledRoom).toBe(false)

    const restart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(restart.status).toBe(200)
    const restartedRoom = await restart.json()

    await createRoomStartModule(prisma).advanceDueRoomStarts({ now: new Date(restartedRoom.startsAt) })
    const startedRoomResponse = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(startedRoomResponse.status).toBe(200)
    const startedRoom = await startedRoomResponse.json()
    expect(startedRoom.roomId).toBe(room.roomId)
    expect(startedRoom.status).toBe('started')
    expect(startedRoom.tenderId).toBeString()
    await expectRoomHiddenFromExtra()
    const tenderId = startedRoom.tenderId as string
    expect(await prisma.tender.findUnique({ where: { id: tenderId } })).not.toBeNull()

    const playerView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(playerView.status).toBe(200)
    expect(await playerView.json()).toMatchObject({
      phase: 'access-slot-selection',
      serverTime: expect.any(String),
      tenderId,
    })

    const outsiderView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${extra.accessToken}` },
    })
    const absentView = await app.request('/api/tenders/00000000-0000-4000-8000-000000000000', {
      headers: { Authorization: `Bearer ${extra.accessToken}` },
    })
    expect(outsiderView.status).toBe(404)
    expect(absentView.status).toBe(404)
    expect(await outsiderView.json()).toEqual(await absentView.json())

    const command = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: user.id,
        commandId: 'access-slot-host-1',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(command.status).toBe(200)
    expect(await command.json()).toEqual({ tenderId, version: 1 })

    const workingModelCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: user.id,
        commandId: 'working-model-host-1',
        tenderId,
        type: 'update-working-model',
        workingModel: {
          signals: {
            aster: { note: 'Host-only hypothesis' },
          },
        },
      }),
    })
    expect(workingModelCommand.status).toBe(200)

    const hostPrivateView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const joinerPrivateView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(hostPrivateView.status).toBe(200)
    expect(joinerPrivateView.status).toBe(200)
    expect(await hostPrivateView.json()).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({ playerId: user.id, requestedAccessSlot: 3 }),
      ]),
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateResearchCertifications: [],
      privateSamples: [],
      privateUsedContractEvidenceTestIds: [],
      privateWorkingModel: {
        signals: {
          aster: { note: 'Host-only hypothesis' },
        },
      },
    })
    const joinerPrivateBody = await joinerPrivateView.json()
    expect(joinerPrivateBody).toMatchObject({
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateResearchCertifications: [],
      privateSamples: [],
      privateUsedContractEvidenceTestIds: [],
      privateWorkingModel: { signals: {} },
    })
    expect(joinerPrivateBody.players.find((player: { playerId: string }) => player.playerId === user.id))
      .not.toHaveProperty('requestedAccessSlot')
  }, 10_000)

  test('does not expose or mutate a Tender when an outsider submits a command by id', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      expect(response.status).toBe(201)
      return response.json()
    }
    const player = await register('tender-command-idor-player')
    const secondPlayer = await register('tender-command-idor-second-player')
    const outsider = await register('tender-command-idor-outsider')
    const { tenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.user.id, tiePriority: 1 },
        { id: secondPlayer.user.id, tiePriority: 2 },
      ],
    })
    const acceptedParticipantCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'shared-access-slot-command',
        slot: 2,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(acceptedParticipantCommand.status).toBe(200)
    const absentTenderId = '00000000-0000-4000-8000-000000000000'
    const submitCommand = (targetTenderId: string) => app.request(
      `/api/tenders/${targetTenderId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${outsider.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actorId: outsider.user.id,
          commandId: 'shared-access-slot-command',
          slot: 1,
          tenderId: targetTenderId,
          type: 'request-access-slot',
        }),
      },
    )

    const existingTenderCommand = await submitCommand(tenderId)
    const absentTenderCommand = await submitCommand(absentTenderId)

    expect(existingTenderCommand.status).toBe(404)
    expect(absentTenderCommand.status).toBe(404)
    expect(await existingTenderCommand.json()).toEqual(await absentTenderCommand.json())

    const participantCommandIdCollision = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondPlayer.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: secondPlayer.user.id,
        commandId: 'shared-access-slot-command',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(participantCommandIdCollision.status).toBe(409)

    const pathBodyMismatch = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'path-body-mismatch',
        slot: 3,
        tenderId: absentTenderId,
        type: 'request-access-slot',
      }),
    })
    expect(pathBodyMismatch.status).toBe(403)

    const actorImpersonation = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondPlayer.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'actor-impersonation',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(actorImpersonation.status).toBe(403)

    const { tenderId: secondTenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.user.id, tiePriority: 1 },
        { id: secondPlayer.user.id, tiePriority: 2 },
      ],
    })
    const sameCommandIdInAnotherTender = await app.request(`/api/tenders/${secondTenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'shared-access-slot-command',
        slot: 4,
        tenderId: secondTenderId,
        type: 'request-access-slot',
      }),
    })
    expect(sameCommandIdInAnotherTender.status).toBe(200)
    expect(await sameCommandIdInAnotherTender.json()).toEqual({
      tenderId: secondTenderId,
      version: 1,
    })

    const participantView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    })
    expect(participantView.status).toBe(200)
    const participantBody = await participantView.json()
    expect(participantBody.version).toBe(1)
    expect(participantBody.players.find((candidate: { playerId: string }) =>
      candidate.playerId === player.user.id)).toMatchObject({ requestedAccessSlot: 2 })
    expect(participantBody.players.some((candidate: { playerId: string }) =>
      candidate.playerId === outsider.user.id)).toBe(false)
  })

  test('exposes one current room and blocks creating another until the player leaves', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'single-current-room',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken } = await register.json()
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    const firstRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(firstRoom.status).toBe(201)
    const created = await firstRoom.json()

    const currentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(currentRoom.status).toBe(200)
    expect(await currentRoom.json()).toMatchObject({
      match: {
        roomId: created.roomId,
        status: 'waiting',
      },
    })

    const blockedRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(blockedRoom.status).toBe(409)
    expect(await blockedRoom.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const otherRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'single-current-other-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const other = await otherRegister.json()
    const otherRoomResponse = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const otherRoom = await otherRoomResponse.json()
    const blockedJoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: otherRoom.joinCode }),
    })
    expect(blockedJoin.status).toBe(409)
    expect(await blockedJoin.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const leave = await app.request(`/api/rooms/${created.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(leave.status).toBe(204)

    const noCurrentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(noCurrentRoom.status).toBe(200)
    expect(await noCurrentRoom.json()).toEqual({ match: null })

    const replacementRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(replacementRoom.status).toBe(201)
  })

  test('does not expose direct room joining by guessed room id', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'direct-join-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const host = await hostRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()

    const outsiderRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'direct-join-outsider',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const outsider = await outsiderRegister.json()
    const guessedRoomJoin = await app.request(`/api/rooms/${room.roomId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${outsider.accessToken}` },
    })

    expect(guessedRoomJoin.status).toBe(404)
  })

  test('does not let an outsider leave or discover a room by guessed room id', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-idor-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const host = await hostRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()

    const outsiderRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-idor-outsider',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const outsider = await outsiderRegister.json()
    const authorization = { Authorization: `Bearer ${outsider.accessToken}` }
    const existingRoomLeave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: authorization,
    })
    const absentRoomLeave = await app.request('/api/rooms/019f8099-7e26-7760-ad08-66d1d66b2719/leave', {
      method: 'POST',
      headers: authorization,
    })

    expect(existingRoomLeave.status).toBe(404)
    expect(absentRoomLeave.status).toBe(404)
    expect(await existingRoomLeave.json()).toEqual(await absentRoomLeave.json())
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: {
        hostId: true,
        members: { select: { userId: true } },
        currentMatches: { select: { userId: true } },
      },
    })).toEqual({
      hostId: host.user.id,
      members: [{ userId: host.user.id }],
      currentMatches: [{ userId: host.user.id }],
    })
  })

  test('only lets room members change their own readiness without exposing room existence', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      return response.json()
    }
    const host = await register('ready-idor-host')
    const member = await register('ready-idor-member')
    const outsider = await register('ready-idor-outsider')
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })

    const setReady = (accessToken: string, roomId: string, ready: boolean) => app.request(
      `/api/rooms/${roomId}/ready`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ready }),
      },
    )

    const memberReady = await setReady(member.accessToken, room.roomId, true)
    expect(memberReady.status).toBe(200)
    expect(await memberReady.json()).toMatchObject({
      members: [
        { ready: false, userId: host.user.id },
        { ready: true, userId: member.user.id },
      ],
    })
    const memberNotReady = await setReady(member.accessToken, room.roomId, false)
    expect(memberNotReady.status).toBe(200)
    expect(await memberNotReady.json()).toMatchObject({
      members: [
        { ready: false, userId: host.user.id },
        { ready: false, userId: member.user.id },
      ],
    })

    for (const ready of [true, false]) {
      const existingRoom = await setReady(outsider.accessToken, room.roomId, ready)
      const absentRoom = await setReady(
        outsider.accessToken,
        '019f8099-7e26-7760-ad08-66d1d66b2719',
        ready,
      )
      expect(existingRoom.status).toBe(404)
      expect(await existingRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoomMember.findMany({
      where: { roomId: room.roomId },
      orderBy: { seat: 'asc' },
      select: { ready: true, userId: true },
    })).toEqual([
      { ready: false, userId: host.user.id },
      { ready: false, userId: member.user.id },
    ])

    await setReady(host.accessToken, room.roomId, true)
    await setReady(member.accessToken, room.roomId, true)
    const startRoom = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(startRoom.status).toBe(200)

    const memberAfterStart = await setReady(member.accessToken, room.roomId, false)
    expect(memberAfterStart.status).toBe(409)
    const outsiderAfterStart = await setReady(outsider.accessToken, room.roomId, false)
    const absentAfterStart = await setReady(
      outsider.accessToken,
      '019f8099-7e26-7760-ad08-66d1d66b2719',
      false,
    )
    expect(outsiderAfterStart.status).toBe(404)
    expect(await outsiderAfterStart.json()).toEqual(await absentAfterStart.json())
  })

  test('only lets the path room host schedule its start without exposing other rooms', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      return response.json()
    }
    const firstHost = await register('start-idor-first-host')
    const secondHost = await register('start-idor-second-host')
    const secondMember = await register('start-idor-second-member')
    const outsider = await register('start-idor-outsider')
    const createRoom = async (accessToken: string) => {
      const response = await app.request('/api/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capacity: 2 }),
      })
      return response.json()
    }
    const firstRoom = await createRoom(firstHost.accessToken)
    const secondRoom = await createRoom(secondHost.accessToken)
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondMember.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: secondRoom.joinCode }),
    })
    const startRoom = (accessToken: string, roomId: string) => app.request(
      `/api/rooms/${roomId}/start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    const absentRoomId = '019f8099-7e26-7760-ad08-66d1d66b2719'
    const tenderCountBefore = await prisma.tender.count()

    for (const [accessToken, foreignRoomId] of [
      [firstHost.accessToken, secondRoom.roomId],
      [secondMember.accessToken, firstRoom.roomId],
      [outsider.accessToken, secondRoom.roomId],
    ] as const) {
      const existingForeignRoom = await startRoom(accessToken, foreignRoomId)
      const absentRoom = await startRoom(accessToken, absentRoomId)

      expect(existingForeignRoom.status).toBe(404)
      expect(await existingForeignRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoom.findMany({
      where: { id: { in: [firstRoom.roomId, secondRoom.roomId] } },
      orderBy: { id: 'asc' },
      select: { id: true, startsAt: true, status: true, tenderId: true },
    })).toEqual([
      { id: firstRoom.roomId, startsAt: null, status: 'waiting', tenderId: null },
      { id: secondRoom.roomId, startsAt: null, status: 'waiting', tenderId: null },
    ].sort((left, right) => left.id.localeCompare(right.id)))
    expect(await prisma.tender.count()).toBe(tenderCountBefore)
  })

  test('only lets the target room host cancel its start without exposing other rooms', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      return response.json()
    }
    const host = await register('cancel-start-idor-host')
    const member = await register('cancel-start-idor-member')
    const otherHost = await register('cancel-start-idor-other-host')
    const outsider = await register('cancel-start-idor-outsider')
    const createRoom = async (accessToken: string) => {
      const response = await app.request('/api/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capacity: 2 }),
      })
      return response.json()
    }
    const room = await createRoom(host.accessToken)
    await createRoom(otherHost.accessToken)
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    const setReady = (accessToken: string) => app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect((await setReady(host.accessToken)).status).toBe(200)
    expect((await setReady(member.accessToken)).status).toBe(200)
    const start = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(start.status).toBe(200)
    const scheduledRoom = await start.json()
    const cancelStart = (accessToken: string, roomId: string) => app.request(
      `/api/rooms/${roomId}/cancel-start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    const absentRoomId = '019f8099-7e26-7760-ad08-66d1d66b2719'
    const tenderCountBefore = await prisma.tender.count()

    for (const accessToken of [
      member.accessToken,
      otherHost.accessToken,
      outsider.accessToken,
    ] as const) {
      const existingForeignRoom = await cancelStart(accessToken, room.roomId)
      const absentRoom = await cancelStart(accessToken, absentRoomId)

      expect(existingForeignRoom.status).toBe(404)
      expect(await existingForeignRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: { startsAt: true, status: true, tenderId: true },
    })).toEqual({
      startsAt: new Date(scheduledRoom.startsAt),
      status: 'starting',
      tenderId: null,
    })
    expect(await prisma.tender.count()).toBe(tenderCountBefore)

    const legitimateCancel = await cancelStart(host.accessToken, room.roomId)
    expect(legitimateCancel.status).toBe(200)
    expect(await legitimateCancel.json()).toMatchObject({
      roomId: room.roomId,
      status: 'waiting',
    })
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: { startsAt: true, status: true, tenderId: true },
    })).toEqual({
      startsAt: null,
      status: 'waiting',
      tenderId: null,
    })
    expect(await prisma.tender.count()).toBe(tenderCountBefore)
  })

  test('transfers a waiting room to the remaining member when its host leaves', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-host-transfer-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const host = await hostRegister.json()
    const memberRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-host-transfer-member',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const member = await memberRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()
    const joinRoom = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    expect(joinRoom.status).toBe(200)

    const leave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(leave.status).toBe(204)

    const roomForMember = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${member.accessToken}` },
    })
    expect(roomForMember.status).toBe(200)
    expect(await roomForMember.json()).toMatchObject({
      hostId: member.user.id,
      members: [{ ready: false, userId: member.user.id }],
      status: 'waiting',
    })
    const formerHostCurrentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(formerHostCurrentRoom.status).toBe(200)
    expect(await formerHostCurrentRoom.json()).toEqual({ match: null })
  })

  test('creates only one current room across concurrent requests from one player', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'concurrent-current-room',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken } = await register.json()
    const request = () => app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })

    const responses = await Promise.all([request(), request()])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const currentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(currentRoom.status).toBe(200)
    expect((await currentRoom.json()).match.roomId).toBeString()
  })

  test('returns one durable successor across three concurrent refresh requests', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login: 'race',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registerBody = await register.json()

    const refreshRequests = await Promise.all([
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
    ])

    const statuses = refreshRequests.map((response) => response.status)
    expect(statuses).toEqual([200, 200, 200])
    const refreshBodies = await Promise.all(refreshRequests.map((response) => response.json()))
    const returnedRefreshTokens = refreshBodies.map((body) => body.refreshToken)
    expect(new Set(returnedRefreshTokens).size).toBe(1)

    const activeSessions = await prisma.authSession.count({
      where: {
        user: {
          login: 'race',
        },
        revokedAt: null,
      },
    })
    expect(activeSessions).toBe(1)

    const totalSessions = await prisma.authSession.count({
      where: {
        user: {
          login: 'race',
        },
      },
    })
    expect(totalSessions).toBe(1)

    await prisma.authSession.updateMany({
      where: { user: { login: 'race' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const delayedWinner = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: returnedRefreshTokens.at(-1) }),
    })
    expect(delayedWinner.status).toBe(200)
  })

  test('revokes a session when any older refresh credential is reused after grace', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'reuse',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registered = await register.json()
    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    const refreshed = await refresh.json()

    const refreshAgain = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
    })
    const refreshedAgain = await refreshAgain.json()
    expect(refreshAgain.status).toBe(200)

    await prisma.authSession.updateMany({
      where: { user: { login: 'reuse' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const replay = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    expect(replay.status).toBe(401)

    const attackerCredential = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshedAgain.refreshToken }),
    })
    expect(attackerCredential.status).toBe(401)
  })

  test('web auth never exposes its HttpOnly refresh token when the client platform header is spoofed', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        login: 'web-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('anomaly_detector_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setCookie!.split(';')[0],
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({}),
    })
    const refreshBody = await refresh.json()

    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeUndefined()
  })

  test('does not let cookie and explicit token transports borrow each other credentials', async () => {
    const refreshToken = 'r'.repeat(32)
    const cookieWithBodyToken = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(cookieWithBodyToken.status).toBe(400)

    const tokenWithCookieOnly = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `anomaly_detector_refresh=${refreshToken}`,
      },
      body: JSON.stringify({}),
    })
    expect(tokenWithCookieOnly.status).toBe(400)
  })

  test('production web auth allows an exact same-site custom-domain origin', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        login: 'production-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(register.headers.get('access-control-allow-origin')).toBe('https://web.example.com')
    expect(register.headers.get('access-control-allow-credentials')).toBe('true')
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('anomaly_detector_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=None')
  })

  test('production cookie auth rejects untrusted refresh and logout origins', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        login: 'csrf-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const cookie = register.headers.get('set-cookie')!.split(';')[0]

    const noOriginRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({}),
    })
    const noOriginBody = await noOriginRefresh.json()
    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await productionApp.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()
    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')

    const allowedRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({}),
    })
    expect(allowedRefresh.status).toBe(200)
  })

  test('guards me and returns stable validation errors', async () => {
    const unauthorizedMe = await app.request('/api/auth/me')
    expect(unauthorizedMe.status).toBe(401)

    const invalidRegister = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'not-an-login',
        password: 'short',
      }),
    })
    const body = await invalidRegister.json()

    expect(invalidRegister.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Invalid request payload')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('me rejects revoked, expired, and missing sessions', async () => {
    const revoked = await registerForMeGuard('me-revoked')
    await prisma.authSession.updateMany({
      where: {
        userId: revoked.userId,
      },
      data: {
        revokedAt: new Date(),
      },
    })
    const revokedMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${revoked.accessToken}`,
      },
    })
    expect(revokedMe.status).toBe(401)

    const expired = await registerForMeGuard('me-expired')
    await prisma.authSession.updateMany({
      where: {
        userId: expired.userId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    const expiredMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${expired.accessToken}`,
      },
    })
    expect(expiredMe.status).toBe(401)

    const missing = await registerForMeGuard('me-missing')
    await prisma.authSession.deleteMany({
      where: {
        userId: missing.userId,
      },
    })
    const missingMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${missing.accessToken}`,
      },
    })
    expect(missingMe.status).toBe(401)
  })

  test('enforces absolute session lifetime in PostgreSQL for access and refresh credentials', async () => {
    const absoluteExpired = await registerForMeGuard('absolute-expired')
    await prisma.authSession.updateMany({
      where: { userId: absoluteExpired.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 60) * 1000,
        ),
      },
    })

    const expiredMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${absoluteExpired.accessToken}` },
    })
    const expiredRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: absoluteExpired.refreshToken }),
    })

    expect(expiredMe.status).toBe(401)
    expect(expiredRefresh.status).toBe(401)

    const nearCutoff = await registerForMeGuard('absolute-near-cutoff')
    await prisma.authSession.updateMany({
      where: { userId: nearCutoff.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 - 60) * 1000,
        ),
      },
    })

    const activeMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${nearCutoff.accessToken}` },
    })
    const activeRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: nearCutoff.refreshToken }),
    })

    expect(activeMe.status).toBe(200)
    expect(activeRefresh.status).toBe(200)
  })

  test('rejects duplicate login and invalid login', async () => {
    const payload = {
      login: 'dupe',
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    }

    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const duplicate = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(duplicate.status).toBe(409)

    const invalidLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: payload.login,
        password: 'wrong-password',
      }),
    })
    expect(invalidLogin.status).toBe(401)
  })

  test('rehashes a verified legacy password and never exposes password material', async () => {
    const password = 'correct horse battery staple'
    const legacyHash = await Bun.password.hash(password, {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    })
    await prisma.user.create({
      data: {
        login: 'legacy-password',
        passwordHash: legacyHash,
      },
    })

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'legacy-password', password }),
    })
    const responseText = await login.text()
    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { login: 'legacy-password' },
    })

    expect(login.status).toBe(200)
    expect(storedUser.passwordHash).toStartWith('$argon2id$v=19$m=65536,t=2,p=1$')
    expect(storedUser.passwordHash).not.toBe(legacyHash)
    expect(await Bun.password.verify(password, storedUser.passwordHash)).toBe(true)
    expect(responseText).not.toContain(password)
    expect(responseText).not.toContain(legacyHash)
    expect(responseText).not.toContain(storedUser.passwordHash)
  })

  test('treats a non-password account record as invalid credentials', async () => {
    await prisma.user.create({
      data: {
        login: 'oauth-only',
        passwordHash: 'OAUTH_USER',
      },
    })

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'oauth-only', password: 'password123' }),
    })

    expect(login.status).toBe(401)
    expect(await login.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
    })
  })

  test('deleting an account removes auth links and its identifier from Tender history', async () => {
    const register = async (login: string, displayName: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      expect(response.status).toBe(201)
      return response.json()
    }
    const deletedAccount = await register('delete-me', 'Анна')
    const remainingAccount = await register('keep-me', 'Борис')
    const deletedUserId = deletedAccount.user.id as string
    const remainingUserId = remainingAccount.user.id as string
    const tender = createPersistentTenderModule(prisma)
    const { tenderId } = await tender.createTender({
      players: [
        { displayName: 'Анна', id: deletedUserId, tiePriority: 1 },
        { displayName: 'Борис', id: remainingUserId, tiePriority: 2 },
      ],
    })
    await prisma.authIdentity.create({
      data: {
        provider: 'yandex',
        subject: 'deleted-provider-subject',
        userId: deletedUserId,
      },
    })

    const deleted = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${deletedAccount.accessToken}` },
    })

    expect(deleted.status).toBe(204)
    expect(await prisma.authIdentity.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.authSession.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedUserId },
      select: {
        displayName: true,
        privacyConsentAt: true,
        privacyConsentVersion: true,
        termsAcceptedAt: true,
        termsVersion: true,
      },
    })).toEqual({
      displayName: null,
      privacyConsentAt: null,
      privacyConsentVersion: null,
      termsAcceptedAt: null,
      termsVersion: null,
    })

    const oldPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'delete-me', password: 'password123' }),
    })
    expect(oldPasswordLogin.status).toBe(401)

    const remainingView = await tender.readTenderView({
      playerId: remainingUserId,
      tenderId,
    })
    expect(JSON.stringify(remainingView)).not.toContain(deletedUserId)
    expect(remainingView.players).toContainEqual(expect.objectContaining({
      displayName: 'Deleted participant',
      playerId: expect.stringMatching(/^deleted-participant-/),
    }))
  })

  test('limits password login after five failures and resets the login budget on success', async () => {
    const login = 'password-attempt-budget'
    const password = 'password123'
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password,
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    expect(register.status).toBe(201)

    const attempt = (attemptPassword: string) => app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: attemptPassword }),
    })

    for (let index = 0; index < 4; index += 1) {
      const failure = await attempt('wrong-password')
      expect(failure.status).toBe(401)
      expect(await failure.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
      })
    }

    expect((await attempt(password)).status).toBe(200)

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt('wrong-password')).status).toBe(401)
    }
    const limited = await attempt('wrong-password')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Invalid login or password. Try again later.',
      },
    })

    const unknown = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'unknown-password-budget', password: 'wrong-password' }),
    })
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
    })
  })

  test('atomically limits six concurrent password failures for one login', async () => {
    const login = 'concurrent-password-budget'
    await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const attempts = await Promise.all(Array.from({ length: 6 }, () =>
      app.request('/api/auth/token/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: 'wrong-password' }),
      })))

    expect(attempts.map((response) => response.status).sort()).toEqual([
      401, 401, 401, 401, 401, 429,
    ])
  })

  test('limits password verification by client address independently from login buckets', async () => {
    const attempt = (index: number, ipAddress: string) => app.request('/api/auth/token/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': ipAddress,
      },
      body: JSON.stringify({
        login: `unknown-ip-budget-${index}`,
        password: 'wrong-password',
      }),
    })

    for (let index = 1; index <= 30; index += 1) {
      expect((await attempt(index, '203.0.113.20')).status).toBe(401)
    }
    expect((await attempt(31, '203.0.113.20')).status).toBe(429)
    expect((await attempt(31, '203.0.113.21')).status).toBe(401)
  }, 10_000)

  test('returns one created user and one conflict for concurrent duplicate registration', async () => {
    const payload = {
      login: 'register-race',
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    }

    const [first, second] = await Promise.all([
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([201, 409])

    const users = await prisma.user.count({
      where: {
        login: payload.login,
      },
    })
    expect(users).toBe(1)
  })

  test('allows only three password registrations for one signed browser device token', async () => {
    const register = (login: string, cookie?: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })

    const first = await register('device-quota-1')
    expect(first.status).toBe(201)
    const firstBody = await first.json()
    const deviceCookie = first.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => cookie.startsWith('anomaly_detector_device='))
    expect(deviceCookie).toBeString()
    expect(first.headers.getSetCookie().find((cookie) =>
      cookie.startsWith('anomaly_detector_device='))).toContain('HttpOnly')

    expect((await register('device-quota-2', deviceCookie)).status).toBe(201)
    const concurrent = await Promise.all([
      register('device-quota-3', deviceCookie),
      register('device-quota-4', deviceCookie),
    ])
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 429])

    const fourth = await register('device-quota-5', deviceCookie)
    expect(fourth.status).toBe(429)
    expect(await fourth.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Registration limit reached. Try again later.',
      },
    })

    const deleteFirstAccount = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${firstBody.accessToken}` },
    })
    expect(deleteFirstAccount.status).toBe(204)
    expect((await register('device-quota-after-delete', deviceCookie)).status).toBe(429)

    const forged = await register(
      'device-quota-forged',
      'anomaly_detector_device=forged.invalid',
    )
    expect(forged.status).toBe(201)
    expect(forged.headers.getSetCookie().some((cookie) =>
      cookie.startsWith('anomaly_detector_device=')
      && !cookie.startsWith('anomaly_detector_device=forged.invalid'))).toBe(true)
  })

  test('applies an independent wider IP budget to password registrations', async () => {
    for (let index = 1; index <= 20; index += 1) {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          login: `registration-ip-budget-${index}`,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        }),
      })
      expect(response.status).toBe(201)
    }

    const limited = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '203.0.113.10',
      },
      body: JSON.stringify({
        login: 'registration-ip-budget-limited',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    expect(limited.status).toBe(429)
  })

  async function registerForMeGuard(login: string) {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const registerBody = await register.json()
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        login,
      },
      select: {
        id: true,
      },
    })

    expect(register.status).toBe(201)
    expect(registerBody.accessToken).toBeString()

    return {
      accessToken: registerBody.accessToken as string,
      refreshToken: registerBody.refreshToken as string,
      userId: user.id,
    }
  }
})
