import { z } from 'zod'
import { botDifficultySchema } from './bots'

export const roomCapacitySchema = z.union([z.literal(2), z.literal(3), z.literal(4)])
export const roomIdSchema = z.string().uuid()
export const roomJoinCodeSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/)
export const roomStatusSchema = z.enum(['waiting', 'starting', 'started'])

export const createRoomRequestSchema = z.object({
  allowBots: z.boolean().default(false),
  capacity: roomCapacitySchema,
}).strict()

export const addRoomBotRequestSchema = z.object({
  difficulty: z.literal('easy'),
  seat: z.number().int().min(1).max(4),
}).strict()

export const updateRoomBotDifficultyRequestSchema = z.object({
  difficulty: botDifficultySchema,
}).strict()

export const setRoomReadyRequestSchema = z.object({
  ready: z.boolean(),
}).strict()

export const joinRoomByCodeRequestSchema = z.object({
  code: z.string()
    .transform((value) => value.trim().replaceAll(/[\s-]/g, '').toUpperCase())
    .pipe(roomJoinCodeSchema),
}).strict()

export const roomMemberSchema = z.object({
  displayName: z.string().min(1).max(80),
  ready: z.boolean(),
  seat: z.number().int().positive(),
  userId: z.string().uuid(),
}).strict()

export const roomBotSchema = z.object({
  difficulty: botDifficultySchema,
  id: z.string().uuid(),
  seat: z.number().int().positive(),
}).strict()

export const roomViewSchema = z.object({
  allowBots: z.boolean(),
  bots: z.array(roomBotSchema).optional(),
  capacity: roomCapacitySchema,
  hostId: z.string().uuid(),
  joinCode: roomJoinCodeSchema.nullable(),
  members: z.array(roomMemberSchema),
  roomId: roomIdSchema,
  serverTime: z.string().datetime(),
  status: roomStatusSchema,
  startsAt: z.string().datetime().nullable().optional(),
  tenderId: z.string().uuid().nullable().optional(),
  tenderCompletionReason: z.enum([
    'all_players_left',
    'last_active_player',
    'all_players_forfeited',
    'no_human_players',
  ]).optional(),
  tenderForfeited: z.boolean().optional(),
  tenderPhase: z.string().optional(),
  tenderPlacement: z.number().int().min(1).max(4).optional(),
  tenderRuleset: z.enum(['tender-v1', 'tender-v2']).optional(),
}).strict()

export const myMatchesResponseSchema = z.object({
  matches: z.array(roomViewSchema),
}).strict()

export const currentMatchResponseSchema = z.object({
  match: roomViewSchema.nullable(),
}).strict()

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>
export type AddRoomBotRequest = z.infer<typeof addRoomBotRequestSchema>
export type CurrentMatchResponse = z.infer<typeof currentMatchResponseSchema>
export type JoinRoomByCodeRequest = z.input<typeof joinRoomByCodeRequestSchema>
export type JoinRoomByCodePayload = z.output<typeof joinRoomByCodeRequestSchema>
export type UpdateRoomBotDifficultyRequest = z.infer<typeof updateRoomBotDifficultyRequestSchema>
export type RoomMember = z.infer<typeof roomMemberSchema>
export type RoomBot = z.infer<typeof roomBotSchema>
export type RoomView = z.infer<typeof roomViewSchema>
export type SetRoomReadyRequest = z.infer<typeof setRoomReadyRequestSchema>
