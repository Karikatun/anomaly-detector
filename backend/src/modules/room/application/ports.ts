import type { RoomMember, RoomView } from '@anomaly-detector/contracts'

export type RoomRecord = Omit<RoomView, 'joinCode' | 'members' | 'roomId' | 'serverTime'> & {
  id: string
  joinCode?: string | null
  members: Array<Omit<RoomMember, 'displayName'>>
}

export type RoomMemberIdentityReader = {
  readDisplayNames(userIds: string[]): Promise<Map<string, string>>
}

export type MatchPlacementReader = {
  readPlacement(input: { playerId: string; tenderId: string }): Promise<number | undefined>
}

export type RoomRepository = {
  create(input: { capacity: 2 | 3 | 4; hostId: string }): Promise<RoomRecord>
  cancelStart?: (input: { actorId: string; roomId: string }) => Promise<RoomRecord>
  readCurrentForMember?: (userId: string) => Promise<RoomRecord | null>
  listStartedForMember?: (userId: string) => Promise<RoomRecord[]>
  readForMember?: (input: { actorId: string; roomId: string }) => Promise<RoomRecord>
  join(input: { actorId: string; roomId: string }): Promise<RoomRecord>
  joinByCode?: (input: { actorId: string; code: string }) => Promise<RoomRecord>
  leave(input: { actorId: string; roomId: string }): Promise<void>
  setReady(input: { actorId: string; ready: boolean; roomId: string }): Promise<RoomRecord>
  start(input: { actorId: string; roomId: string }): Promise<RoomRecord>
}
