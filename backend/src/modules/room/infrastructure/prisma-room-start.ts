import { isRetryableDatabaseTransactionConflict, type DbClient } from '../../../db'
import { lockActiveAccountLifecycleTransaction } from '../../../security/account-lifecycle-lock'
import { createPersistentTenderModule } from '../../tender'

const roomStartTransactionMaxAttempts = 3

export type AdvanceDueRoomStartsResult = {
  started: Array<{ roomId: string; tenderId: string }>
}

export function createRoomStartModule(db: DbClient, accountLifecycleSecret?: string) {
  return {
    async advanceDueRoomStarts({ now }: { now: Date }): Promise<AdvanceDueRoomStartsResult> {
      const dueRooms = await db.tenderRoom.findMany({
        where: { startsAt: { lte: now }, status: 'starting' },
        select: { id: true },
      })
      const started: AdvanceDueRoomStartsResult['started'] = []

      for (const room of dueRooms) {
        const result = await startDueRoom(db, room.id, now, accountLifecycleSecret)
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

async function startDueRoom(
  db: DbClient,
  roomId: string,
  now: Date,
  accountLifecycleSecret?: string,
) {
  for (let attempt = 0; attempt < roomStartTransactionMaxAttempts; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room || room.status !== 'starting' || !room.startsAt || room.startsAt > now) return null

        if (accountLifecycleSecret) {
          const memberIds = room.members.map((member) => member.userId).sort()
          for (const memberId of memberIds) {
            if (!await lockActiveAccountLifecycleTransaction(
              tx,
              accountLifecycleSecret,
              memberId,
            )) return null
          }
        }

        const users = await tx.user.findMany({
          where: {
            id: { in: room.members.map((member) => member.userId) },
            ...(accountLifecycleSecret ? { anonymizedAt: null } : {}),
          },
          select: { id: true, displayName: true },
        })
        if (users.length !== room.members.length) return null
        const displayNameById = new Map(users.map((user) => [user.id, user.displayName]))
        const tender = createPersistentTenderModule(tx as DbClient, accountLifecycleSecret)
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
    } catch (error) {
      if (!isRetryableDatabaseTransactionConflict(error) || attempt >= roomStartTransactionMaxAttempts - 1) {
        throw error
      }
      await waitForRoomStartTransactionRetry(attempt)
    }
  }

  throw new Error('Unreachable Room start transaction retry state')
}

function waitForRoomStartTransactionRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
}
