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

  async listMatches(actorId: string): Promise<RoomView[]> {
    const rooms = await this.dependencies.repository.listStartedForMember?.(actorId) ?? []
    return rooms.map(toRoomView)
  }

  async leaveRoom(input: { actorId: string; roomId: string }) {
    await this.dependencies.repository.leave(input)
  }

  async startRoom(input: { actorId: string; roomId: string }): Promise<RoomView> {
    return toRoomView(await this.dependencies.repository.start(input))
  }

  async cancelRoomStart(input: { actorId: string; roomId: string }): Promise<RoomView> {
    const cancelStart = this.dependencies.repository.cancelStart
    if (!cancelStart) throw new Error('Room start cancellation is unavailable')
    return toRoomView(await cancelStart(input))
  }

  startAdvanceLoop(intervalMs = 250) {
    const interval = setInterval(() => {
      void this.dependencies.repository.advanceDueStarts?.().catch(() => {
        // The next loop retries durable starts after a transient database failure.
      })
    }, intervalMs)
    interval.unref?.()

    return () => clearInterval(interval)
  }
}

function toRoomView(room: Awaited<ReturnType<RoomRepository['create']>>): RoomView {
    return {
      capacity: room.capacity,
      hostId: room.hostId,
      members: room.members,
      roomId: room.id,
      status: room.status,
      ...(room.startsAt === null || room.startsAt === undefined ? {} : { startsAt: room.startsAt }),
      ...(room.tenderId === null ? {} : { tenderId: room.tenderId }),
      ...(room.tenderPhase === undefined ? {} : { tenderPhase: room.tenderPhase }),
    }
}
