import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createPersistentTenderModule } from '../tender'
import { createRoomStartModule } from './index'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Room start integration', () => {
  if (!databaseUrl) return
  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('starts a due Room once and creates its Tender with player name snapshots', async () => {
    const [host, guest] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Хост', login: 'room-host', passwordHash: 'hash' } }),
      prisma.user.create({ data: { displayName: 'Гость', login: 'room-guest', passwordHash: 'hash' } }),
    ])
    const room = await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        hostId: host.id,
        members: { create: [{ seat: 1, userId: host.id }, { seat: 2, userId: guest.id }] },
        startsAt: new Date('2026-07-24T12:00:00.000Z'),
        status: 'starting',
      },
    })

    const roomStart = createRoomStartModule(prisma)

    const result = await roomStart.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })

    expect(result).toEqual({ started: [{ roomId: room.id, tenderId: expect.any(String) }] })
    const tenderId = result.started[0]?.tenderId
    await expect(createPersistentTenderModule(prisma).readTenderView({
      playerId: guest.id,
      tenderId: tenderId!,
    })).resolves.toMatchObject({
      players: [
        { displayName: 'Хост', playerId: host.id, tiePriority: 1 },
        { displayName: 'Гость', playerId: guest.id, tiePriority: 2 },
      ],
    })
    await expect(roomStart.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })).resolves.toEqual({ started: [] })
  })
})
