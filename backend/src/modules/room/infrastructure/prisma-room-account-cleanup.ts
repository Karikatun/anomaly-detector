import type { DbTransaction } from '../../../db'

export async function cleanupPrismaRoomsForAccountDeletion(
  transaction: DbTransaction,
  userId: string,
) {
  const cleanedRoomIds: string[] = []
  while (true) {
    const batch = await cleanupPrismaRoomBatchForAccountDeletionInternal(
      transaction,
      userId,
      25,
    )
    cleanedRoomIds.push(...batch.cleanedRoomIds)
    if (!batch.hasMore) return cleanedRoomIds
  }
}

export async function cleanupPrismaRoomBatchForAccountDeletion(
  transaction: DbTransaction,
  userId: string,
) {
  return cleanupPrismaRoomBatchForAccountDeletionInternal(transaction, userId, 1)
}

async function cleanupPrismaRoomBatchForAccountDeletionInternal(
  transaction: DbTransaction,
  userId: string,
  roomLimit: number,
) {
  const candidateLimit = roomLimit + 1
  const [hostedRooms, memberships] = await Promise.all([
    transaction.tenderRoom.findMany({
      where: { hostId: userId },
      select: { id: true },
      take: candidateLimit,
    }),
    transaction.tenderRoomMember.findMany({
      where: { userId },
      select: { roomId: true },
      take: candidateLimit,
    }),
  ])
  const candidateRoomIds = [...new Set([
    ...hostedRooms.map(({ id }) => id),
    ...memberships.map(({ roomId }) => roomId),
  ])].sort()
  const selectedRoomIds = candidateRoomIds.slice(0, roomLimit)
  const rooms = await transaction.tenderRoom.findMany({
    where: { id: { in: selectedRoomIds } },
    include: { members: { orderBy: { seat: 'asc' } } },
    orderBy: { id: 'asc' },
  })

  const cleanedRoomIds: string[] = []
  for (const room of rooms) {
    const remainingMembers = room.members.filter((member) => member.userId !== userId)
    if (remainingMembers.length === 0) {
      await transaction.tenderRoom.delete({ where: { id: room.id } })
      cleanedRoomIds.push(room.id)
      continue
    }

    await transaction.currentMatch.deleteMany({ where: { roomId: room.id, userId } })
    await transaction.tenderRoomMember.deleteMany({ where: { roomId: room.id, userId } })

    if (room.status === 'waiting' || room.status === 'starting') {
      await transaction.tenderRoomMember.updateMany({
        where: { roomId: room.id },
        data: { ready: false },
      })
    }

    const hostId = remainingMembers.some((member) => member.userId === room.hostId)
      ? room.hostId
      : remainingMembers[0]!.userId
    await transaction.tenderRoom.update({
      where: { id: room.id },
      data: {
        hostId,
        ...(room.status === 'starting' ? { startsAt: null, status: 'waiting' } : {}),
      },
    })
    cleanedRoomIds.push(room.id)
  }

  return { cleanedRoomIds, hasMore: candidateRoomIds.length > roomLimit }
}
