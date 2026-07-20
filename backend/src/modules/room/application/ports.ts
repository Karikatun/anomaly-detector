import type { RoomView } from '@the-game/contracts'

export type RoomRecord = Omit<RoomView, 'roomId'> & { id: string }

export type RoomRepository = {
  create(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomRecord>
}
