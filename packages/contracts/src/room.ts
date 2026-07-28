import { z } from 'zod'

export const roomCapacitySchema = z.union([z.literal(2), z.literal(3), z.literal(4)])
export const roomIdSchema = z.string().uuid()
export const roomJoinCodeSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/)
export const roomStatusSchema = z.enum(['waiting', 'starting', 'started'])

export const createRoomRequestSchema = z.object({
  capacity: roomCapacitySchema,
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

export const roomViewSchema = z.object({
  capacity: roomCapacitySchema,
  hostId: z.string().uuid(),
  joinCode: roomJoinCodeSchema.nullable(),
  members: z.array(roomMemberSchema),
  roomId: roomIdSchema,
  serverTime: z.string().datetime(),
  status: roomStatusSchema,
  startsAt: z.string().datetime().nullable().optional(),
  tenderId: z.string().uuid().nullable().optional(),
  tenderCompletionReason: z.enum(['all_players_left']).optional(),
  tenderPhase: z.string().optional(),
}).strict()

export const myMatchesResponseSchema = z.object({
  matches: z.array(roomViewSchema),
}).strict()

export const currentMatchResponseSchema = z.object({
  match: roomViewSchema.nullable(),
}).strict()

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>
export type CurrentMatchResponse = z.infer<typeof currentMatchResponseSchema>
export type JoinRoomByCodeRequest = z.input<typeof joinRoomByCodeRequestSchema>
export type JoinRoomByCodePayload = z.output<typeof joinRoomByCodeRequestSchema>
export type RoomMember = z.infer<typeof roomMemberSchema>
export type RoomView = z.infer<typeof roomViewSchema>
export type SetRoomReadyRequest = z.infer<typeof setRoomReadyRequestSchema>
