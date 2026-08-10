import { afterAll, describe } from 'bun:test'

import { createPrisma } from '../../../db'
import { createPrismaRoomRepository } from './prisma-room-repository'
import { roomRepositoryContract } from './room-repository.contract-helper.test'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const clock = { now: () => new Date('2026-07-24T12:00:00.000Z') }

maybeDescribe('Prisma Room repository contract', () => {
  if (!databaseUrl) return
  const db = createPrisma(databaseUrl)
  afterAll(() => db.$disconnect())

  roomRepositoryContract('Prisma adapter', async () => {
    const suffix = crypto.randomUUID()
    const host = await db.user.create({ data: { login: `room-host-${suffix}`, passwordHash: 'hash' } })
    const guest = await db.user.create({ data: { login: `room-guest-${suffix}`, passwordHash: 'hash' } })
    return {
      cleanup: async () => {
        await db.tenderRoom.deleteMany({ where: { hostId: host.id } })
        await db.user.deleteMany({ where: { id: { in: [host.id, guest.id] } } })
      },
      guestId: guest.id,
      hostId: host.id,
      repository: createPrismaRoomRepository(db, clock),
    }
  })
})
