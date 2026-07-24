import type { RoomView } from '@anomaly-detector/contracts'

export type RoomRecord = Omit<RoomView, 'roomId'> & { id: string }

export type RoomRepository = {
  create(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomRecord>
  cancelStart?: (input: { actorId: string; roomId: string }) => Promise<RoomRecord>
  listStartedForMember?: (userId: string) => Promise<RoomRecord[]>
  readForMember?: (input: { actorId: string; roomId: string }) => Promise<RoomRecord>
  join(input: { actorId: string; roomId: string }): Promise<RoomRecord>
  leave(input: { actorId: string; roomId: string }): Promise<void>
  setReady(input: { actorId: string; ready: boolean; roomId: string }): Promise<RoomRecord>
  start(input: { actorId: string; roomId: string }): Promise<RoomRecord>
}
