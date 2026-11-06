import type {
  BotDifficulty,
  GameMode,
  RoomMember,
  RoomBot,
  RoomView,
  TenderPhase,
  TenderRuleset,
} from '@anomaly-detector/contracts'

export type RoomRecord = Omit<
  RoomView,
  | 'joinCode'
  | 'members'
  | 'allowBots'
  | 'bots'
  | 'roomId'
  | 'serverTime'
  | 'tenderCompletionReason'
  | 'tenderForfeited'
  | 'tenderPhase'
  | 'tenderRuleset'
> & {
  allowBots?: boolean
  bots?: RoomBot[]
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

export type TenderLifecycleReader = {
  readLifecycle(input: { playerId: string; tenderId: string }): Promise<{
    completionReason?: 'all_players_forfeited' | 'all_players_left' | 'last_active_player' | 'no_human_players'
    forfeited: boolean
    phase: TenderPhase
    ruleset: TenderRuleset
  }>
}

export type Clock = {
  now(): Date
}

type RoomActorCommand = { actorId: string; roomId: string; standardOnly?: boolean }

export type RoomRepository = {
  addBot(input: RoomActorCommand & { difficulty: 'easy'; seat: number }): Promise<RoomRecord>
  create(input: { mode?: GameMode; allowBots?: boolean; capacity: 2 | 3 | 4; hostId: string }): Promise<RoomRecord>
  cancelStart(input: RoomActorCommand): Promise<RoomRecord>
  readCurrentForMember(userId: string): Promise<RoomRecord | null>
  listStartedForMember(userId: string): Promise<RoomRecord[]>
  readForMember(input: RoomActorCommand): Promise<RoomRecord>
  removeBot(input: RoomActorCommand & { botId: string }): Promise<RoomRecord>
  updateBotDifficulty(input: RoomActorCommand & { botId: string; difficulty: BotDifficulty }): Promise<RoomRecord>
  join(input: RoomActorCommand): Promise<RoomRecord>
  readJoinTarget(code: string): Promise<{ id: string; mode?: GameMode }>
  leave(input: RoomActorCommand): Promise<void>
  releaseCurrentForMember(input: { roomId: string; userId: string }): Promise<void>
  setReady(input: RoomActorCommand & { ready: boolean }): Promise<RoomRecord>
  start(input: RoomActorCommand): Promise<RoomRecord>
}
