import type { RoomView } from '@anomaly-detector/contracts'

export type RoomRecord = Omit<RoomView, 'roomId'> & { id: string }

export type RoomRepository = {
  create(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomRecord>
  listStartedForMember?: (userId: string) => Promise<RoomRecord[]>
  join(input: { actorId: string; roomId: string }): Promise<RoomRecord>
  leave(input: { actorId: string; roomId: string }): Promise<void>
  start(input: { actorId: string; roomId: string }): Promise<RoomRecord>
}
