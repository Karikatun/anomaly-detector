import type { RoomView } from '@anomaly-detector/contracts'

import type { RoomMemberIdentityReader, RoomRecord, RoomRepository } from './ports'

type TenderRoomServiceDependencies = {
  memberIdentityReader?: RoomMemberIdentityReader
  repository: RoomRepository
}

export class TenderRoomService {
  constructor(private readonly dependencies: TenderRoomServiceDependencies) {}

  async createRoom(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomView> {
    const room = await this.dependencies.repository.create(input)
    return this.toRoomView(room)
  }

  async joinRoomByCode(input: { actorId: string; code: string }): Promise<RoomView> {
    const joinByCode = this.dependencies.repository.joinByCode
    if (!joinByCode) throw new Error('Room code joining is unavailable')
    const room = await joinByCode(input)
    return this.toRoomView(room)
  }

  async getRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const readForMember = this.dependencies.repository.readForMember
    if (!readForMember) throw new Error('Room reading is unavailable')
    return this.toRoomView(await readForMember(input))
  }

  async listMatches(actorId: string): Promise<RoomView[]> {
    const rooms = await this.dependencies.repository.listStartedForMember?.(actorId) ?? []
    return Promise.all(rooms.map((room) => this.toRoomView(room)))
  }

  async getCurrentMatch(actorId: string): Promise<RoomView | null> {
    const room = await this.dependencies.repository.readCurrentForMember?.(actorId) ?? null
    return room ? this.toRoomView(room) : null
  }

  async leaveRoom(input: { actorId: string; roomId: string }) {
    await this.dependencies.repository.leave(input)
  }

  async setReady(input: { actorId: string; ready: boolean; roomId: string }): Promise<RoomView> {
    return this.toRoomView(await this.dependencies.repository.setReady(input))
  }

  async startRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    return this.toRoomView(await this.dependencies.repository.start(input))
  }

  async cancelRoomStart(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const cancelStart = this.dependencies.repository.cancelStart
    if (!cancelStart) throw new Error('Room start cancellation is unavailable')
    return this.toRoomView(await cancelStart(input))
  }

  private async toRoomView(room: RoomRecord): Promise<RoomView> {
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
      ...(room.tenderCompletionReason === undefined ? {} : { tenderCompletionReason: room.tenderCompletionReason }),
      ...(room.tenderForfeited ? { tenderForfeited: true } : {}),
      ...(room.tenderPhase === undefined ? {} : { tenderPhase: room.tenderPhase }),
      ...(room.tenderRuleset === undefined ? {} : { tenderRuleset: room.tenderRuleset }),
    }
  }
}
