import type { RoomView } from '@anomaly-detector/contracts'

import type { RoomRepository } from './ports'

type TenderRoomServiceDependencies = {
  repository: RoomRepository
}

export class TenderRoomService {
  constructor(private readonly dependencies: TenderRoomServiceDependencies) {}

  async createRoom(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomView> {
    const room = await this.dependencies.repository.create(input)
    return toRoomView(room)
  }

  async joinRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const room = await this.dependencies.repository.join(input)
    return toRoomView(room)
  }

  async joinRoomByCode(input: { actorId: string; code: string }): Promise<RoomView> {
    const joinByCode = this.dependencies.repository.joinByCode
    if (!joinByCode) throw new Error('Room code joining is unavailable')
    const room = await joinByCode(input)
    return toRoomView(room)
  }

  async getRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const readForMember = this.dependencies.repository.readForMember
    if (!readForMember) throw new Error('Room reading is unavailable')
    return toRoomView(await readForMember(input))
  }

  async listMatches(actorId: string): Promise<RoomView[]> {
    const rooms = await this.dependencies.repository.listStartedForMember?.(actorId) ?? []
    return rooms.map(toRoomView)
  }

  async getCurrentMatch(actorId: string): Promise<RoomView | null> {
    const room = await this.dependencies.repository.readCurrentForMember?.(actorId) ?? null
    return room ? toRoomView(room) : null
  }

  async leaveRoom(input: { actorId: string; roomId: string }) {
    await this.dependencies.repository.leave(input)
  }

  async setReady(input: { actorId: string; ready: boolean; roomId: string }): Promise<RoomView> {
    return toRoomView(await this.dependencies.repository.setReady(input))
  }

  async startRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    return toRoomView(await this.dependencies.repository.start(input))
  }

  async cancelRoomStart(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const cancelStart = this.dependencies.repository.cancelStart
    if (!cancelStart) throw new Error('Room start cancellation is unavailable')
    return toRoomView(await cancelStart(input))
  }

}

function toRoomView(room: Awaited<ReturnType<RoomRepository['create']>>): RoomView {
    return {
      capacity: room.capacity,
      hostId: room.hostId,
      joinCode: room.joinCode ?? null,
      members: room.members,
      roomId: room.id,
      serverTime: new Date().toISOString(),
      status: room.status,
      ...(room.startsAt === null || room.startsAt === undefined ? {} : { startsAt: room.startsAt }),
      ...(room.tenderId === null ? {} : { tenderId: room.tenderId }),
      ...(room.tenderCompletionReason === undefined ? {} : { tenderCompletionReason: room.tenderCompletionReason }),
      ...(room.tenderPhase === undefined ? {} : { tenderPhase: room.tenderPhase }),
    }
}
