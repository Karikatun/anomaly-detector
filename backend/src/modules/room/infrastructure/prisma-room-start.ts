import type { DbClient } from '../../../db'
import { createPersistentTenderModule } from '../../tender'

export type AdvanceDueRoomStartsResult = {
  started: Array<{ roomId: string; tenderId: string }>
}

export function createRoomStartModule(db: DbClient) {
  return {
    async advanceDueRoomStarts({ now }: { now: Date }): Promise<AdvanceDueRoomStartsResult> {
      const dueRooms = await db.tenderRoom.findMany({
        where: { startsAt: { lte: now }, status: 'starting' },
        select: { id: true },
      })
      const started: AdvanceDueRoomStartsResult['started'] = []

      for (const room of dueRooms) {
        const result = await startDueRoom(db, room.id, now)
        if (result) started.push(result)
      }

      return { started }
    },
    async releaseCompletedCurrentMatches(): Promise<number> {
      const completedRooms = await db.tenderRoom.findMany({
        where: { tender: { is: { phase: 'complete' } } },
        select: { id: true },
      })
      if (completedRooms.length === 0) return 0
      const released = await db.currentMatch.deleteMany({
        where: { roomId: { in: completedRooms.map((room) => room.id) } },
      })
      return released.count
    },
  }
}

async function startDueRoom(db: DbClient, roomId: string, now: Date) {
  return db.$transaction(async (tx) => {
    const room = await tx.tenderRoom.findUnique({
      where: { id: roomId },
      include: { members: { orderBy: { seat: 'asc' } } },
    })
    if (!room || room.status !== 'starting' || !room.startsAt || room.startsAt > now) return null

    const users = await tx.user.findMany({
      where: { id: { in: room.members.map((member) => member.userId) } },
      select: { id: true, displayName: true },
    })
    const displayNameById = new Map(users.map((user) => [user.id, user.displayName]))
    const tender = createPersistentTenderModule(tx as DbClient)
    const { tenderId } = await tender.createTender({
      players: room.members.map((member) => ({
        id: member.userId,
        tiePriority: member.seat,
        displayName: displayNameById.get(member.userId) ?? member.userId.slice(0, 8),
      })),
    })

    await tx.tenderRoom.update({
      where: { id: room.id },
      data: { status: 'started', startsAt: null, tenderId },
    })
    return { roomId: room.id, tenderId }
  }, { isolationLevel: 'Serializable' })
}
