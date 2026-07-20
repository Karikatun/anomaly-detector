import type { RoomView } from '@the-game/contracts'

import type { RoomRepository } from './ports'

type TenderRoomServiceDependencies = {
  repository: RoomRepository
}

export class TenderRoomService {
  constructor(private readonly dependencies: TenderRoomServiceDependencies) {}

  async createRoom(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomView> {
    const room = await this.dependencies.repository.create(input)
    return {
      capacity: room.capacity,
      hostId: room.hostId,
      members: room.members,
      roomId: room.id,
      status: room.status,
      ...(room.tenderId === null ? {} : { tenderId: room.tenderId }),
    }
  }
}
