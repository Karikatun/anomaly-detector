import { expect, test } from 'bun:test'

import type { RoomRecord, RoomRepository } from '../application/ports'

const fixedNow = new Date('2026-07-24T12:00:00.000Z')
const clock = { now: () => fixedNow }

type ContractFixture = {
  cleanup(): Promise<void>
  guestId: string
  hostId: string
  repository: RoomRepository
}

export const roomRepositoryContract = (
  name: string,
  createFixture: () => Promise<ContractFixture>,
) => {
  test(`${name} supports the complete Room service repository contract`, async () => {
    const fixture = await createFixture()
    try {
      const created = await fixture.repository.create({ capacity: 2, hostId: fixture.hostId })
      expect(created.members).toEqual([{ ready: false, seat: 1, userId: fixture.hostId }])
      expect(await fixture.repository.readCurrentForMember(fixture.hostId)).toMatchObject({ id: created.id })

      const joined = await fixture.repository.joinByCode({ actorId: fixture.guestId, code: created.joinCode! })
      await expect(fixture.repository.join({ actorId: fixture.guestId, roomId: created.id }))
        .resolves.toMatchObject({ id: created.id })
      await expect(fixture.repository.readForMember({ actorId: fixture.guestId, roomId: created.id }))
        .resolves.toMatchObject({ members: joined.members })

      await fixture.repository.setReady({ actorId: fixture.hostId, ready: true, roomId: created.id })
      await fixture.repository.setReady({ actorId: fixture.guestId, ready: true, roomId: created.id })
      await expect(fixture.repository.start({ actorId: fixture.hostId, roomId: created.id })).resolves.toMatchObject({
        startsAt: '2026-07-24T12:00:05.000Z',
        status: 'starting',
      })
      await expect(fixture.repository.cancelStart({ actorId: fixture.hostId, roomId: created.id }))
        .resolves.toMatchObject({ startsAt: null, status: 'waiting' })
      await expect(fixture.repository.listStartedForMember(fixture.hostId)).resolves.toEqual([])

      await fixture.repository.leave({ actorId: fixture.guestId, roomId: created.id })
      await fixture.repository.releaseCurrentForMember({ roomId: created.id, userId: fixture.hostId })
      await expect(fixture.repository.readCurrentForMember(fixture.hostId)).resolves.toBeNull()
    } finally {
      await fixture.cleanup()
    }
  })
}

export function createInMemoryRoomRepository(): RoomRepository {
  let room: RoomRecord | null = null
  const currentByUser = new Map<string, string>()
  const readRoom = () => {
    if (!room) throw new Error('Room does not exist')
    return room
  }
  const repository: RoomRepository = {
    async cancelStart({ roomId }) {
      const current = readRoom()
      if (current.id !== roomId) throw new Error('Room does not exist')
      room = { ...current, startsAt: null, status: 'waiting' }
      return room
    },
    async create({ capacity, hostId }) {
      room = {
        capacity,
        hostId,
        id: 'room',
        joinCode: 'JOINCODE',
        members: [{ ready: false, seat: 1, userId: hostId }],
        startsAt: null,
        status: 'waiting',
        tenderId: null,
      }
      currentByUser.set(hostId, room.id)
      return room
    },
    async join({ actorId, roomId }) {
      const current = readRoom()
      if (current.id !== roomId) throw new Error('Room does not exist')
      if (!current.members.some((member) => member.userId === actorId)) {
        room = {
          ...current,
          members: [
            ...current.members.map((member) => ({ ...member, ready: false })),
            { ready: false, seat: current.members.length + 1, userId: actorId },
          ],
        }
      }
      currentByUser.set(actorId, roomId)
      return readRoom()
    },
    async joinByCode({ actorId, code }) {
      const current = readRoom()
      if (current.joinCode !== code) throw new Error('Room does not exist')
      return repository.join({ actorId, roomId: current.id })
    },
    async leave({ actorId, roomId }) {
      const current = readRoom()
      if (current.id !== roomId) throw new Error('Room does not exist')
      room = { ...current, members: current.members.filter((member) => member.userId !== actorId) }
      currentByUser.delete(actorId)
    },
    async listStartedForMember(userId) {
      return room?.status === 'started' && room.members.some((member) => member.userId === userId)
        ? [room]
        : []
    },
    async readCurrentForMember(userId) {
      return currentByUser.has(userId) ? room : null
    },
    async readForMember({ actorId, roomId }) {
      const current = readRoom()
      if (current.id !== roomId || !current.members.some((member) => member.userId === actorId)) {
        throw new Error('Room does not exist')
      }
      return current
    },
    async releaseCurrentForMember({ userId }) {
      currentByUser.delete(userId)
    },
    async setReady({ actorId, ready, roomId }) {
      const current = readRoom()
      if (current.id !== roomId) throw new Error('Room does not exist')
      room = {
        ...current,
        members: current.members.map((member) => member.userId === actorId ? { ...member, ready } : member),
      }
      return room
    },
    async start({ roomId }) {
      const current = readRoom()
      if (current.id !== roomId) throw new Error('Room does not exist')
      room = {
        ...current,
        startsAt: new Date(clock.now().getTime() + 5_000).toISOString(),
        status: 'starting',
      }
      return room
    },
  }
  return repository
}
