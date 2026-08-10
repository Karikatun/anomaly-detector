import type { RoomView } from '@anomaly-detector/contracts'

import type {
  MatchPlacementReader,
  RoomMemberIdentityReader,
  RoomRecord,
  RoomRepository,
  TenderLifecycleReader,
} from './ports'

type TenderRoomServiceDependencies = {
  matchPlacementReader?: MatchPlacementReader
  memberIdentityReader?: RoomMemberIdentityReader
  repository: RoomRepository
  tenderLifecycleReader?: TenderLifecycleReader
}

export class TenderRoomService {
  constructor(private readonly dependencies: TenderRoomServiceDependencies) {}

  async createRoom(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomView> {
    await this.releaseCompletedCurrentMatch(input.hostId)
    const room = await this.dependencies.repository.create(input)
    return this.toRoomView(room, input.hostId)
  }

  async joinRoomByCode(input: { actorId: string; code: string }): Promise<RoomView> {
    await this.releaseCompletedCurrentMatch(input.actorId)
    const joinByCode = this.dependencies.repository.joinByCode
    if (!joinByCode) throw new Error('Room code joining is unavailable')
    const room = await joinByCode(input)
    return this.toRoomView(room, input.actorId)
  }

  async getRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const readForMember = this.dependencies.repository.readForMember
    if (!readForMember) throw new Error('Room reading is unavailable')
    return this.toRoomView(await readForMember(input), input.actorId)
  }

  async listMatches(actorId: string): Promise<RoomView[]> {
    const rooms = await this.dependencies.repository.listStartedForMember?.(actorId) ?? []
    return Promise.all(rooms.map(async (room) => {
      const lifecycle = await this.readTenderLifecycle(room, actorId)
      const view = await this.toRoomView(room, actorId, lifecycle)
      if (
        lifecycle?.phase !== 'complete'
        || !room.tenderId
        || !this.dependencies.matchPlacementReader
      ) return view
      const tenderPlacement = await this.dependencies.matchPlacementReader.readPlacement({
        playerId: actorId,
        tenderId: room.tenderId,
      })
      return tenderPlacement === undefined ? view : { ...view, tenderPlacement }
    }))
  }

  async getCurrentMatch(actorId: string): Promise<RoomView | null> {
    const room = await this.dependencies.repository.readCurrentForMember?.(actorId) ?? null
    if (!room) return null
    const lifecycle = await this.readTenderLifecycle(room, actorId)
    if (lifecycle && (lifecycle.phase === 'complete' || lifecycle.forfeited)) {
      await this.dependencies.repository.releaseCurrentForMember?.({ roomId: room.id, userId: actorId })
      return null
    }
    return this.toRoomView(room, actorId, lifecycle)
  }

  async leaveRoom(input: { actorId: string; roomId: string }) {
    await this.dependencies.repository.leave(input)
  }

  async setReady(input: { actorId: string; ready: boolean; roomId: string }): Promise<RoomView> {
    return this.toRoomView(await this.dependencies.repository.setReady(input), input.actorId)
  }

  async startRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    return this.toRoomView(await this.dependencies.repository.start(input), input.actorId)
  }

  async cancelRoomStart(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const cancelStart = this.dependencies.repository.cancelStart
    if (!cancelStart) throw new Error('Room start cancellation is unavailable')
    return this.toRoomView(await cancelStart(input), input.actorId)
  }

  private async releaseCompletedCurrentMatch(actorId: string) {
    const room = await this.dependencies.repository.readCurrentForMember?.(actorId)
    if (!room) return
    const lifecycle = await this.readTenderLifecycle(room, actorId)
    if (!lifecycle || (lifecycle.phase !== 'complete' && !lifecycle.forfeited)) return
    await this.dependencies.repository.releaseCurrentForMember?.({ roomId: room.id, userId: actorId })
  }

  private async readTenderLifecycle(room: RoomRecord, actorId: string) {
    if (!room.tenderId || !this.dependencies.tenderLifecycleReader) return undefined
    return this.dependencies.tenderLifecycleReader.readLifecycle({
      playerId: actorId,
      tenderId: room.tenderId,
    })
  }

  private async toRoomView(
    room: RoomRecord,
    actorId: string,
    providedLifecycle?: Awaited<ReturnType<TenderLifecycleReader['readLifecycle']>>,
  ): Promise<RoomView> {
    const lifecycle = providedLifecycle ?? await this.readTenderLifecycle(room, actorId)
    const userIds = room.members.map((member) => member.userId)
    const displayNames = this.dependencies.memberIdentityReader
      ? await this.dependencies.memberIdentityReader.readDisplayNames(userIds)
      : new Map<string, string>()
    return {
      capacity: room.capacity,
      hostId: room.hostId,
      joinCode: room.joinCode ?? null,
      members: room.members.map((member) => ({
        ...member,
        displayName: displayNames.get(member.userId) ?? 'Исследователь',
      })),
      roomId: room.id,
      serverTime: new Date().toISOString(),
      status: room.status,
      ...(room.startsAt === null || room.startsAt === undefined ? {} : { startsAt: room.startsAt }),
      ...(room.tenderId === null ? {} : { tenderId: room.tenderId }),
      ...(lifecycle?.completionReason === undefined
        ? {}
        : { tenderCompletionReason: lifecycle.completionReason }),
      ...(lifecycle?.forfeited ? { tenderForfeited: true } : {}),
      ...(lifecycle?.phase === undefined ? {} : { tenderPhase: lifecycle.phase }),
      ...(lifecycle?.ruleset === undefined ? {} : { tenderRuleset: lifecycle.ruleset }),
    }
  }
}
