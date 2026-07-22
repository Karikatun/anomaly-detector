import { z } from 'zod'

export const roomCapacitySchema = z.union([z.literal(2), z.literal(3), z.literal(4)])
export const roomIdSchema = z.string().uuid()
export const roomStatusSchema = z.enum(['waiting', 'started'])

export const createRoomRequestSchema = z.object({
  capacity: roomCapacitySchema,
}).strict()

export const roomMemberSchema = z.object({
  seat: z.number().int().positive(),
  userId: z.string().uuid(),
}).strict()

export const roomViewSchema = z.object({
  capacity: roomCapacitySchema,
  hostId: z.string().uuid(),
  members: z.array(roomMemberSchema),
  roomId: roomIdSchema,
  status: roomStatusSchema,
  tenderId: z.string().uuid().nullable().optional(),
  tenderPhase: z.string().optional(),
}).strict()

export const myMatchesResponseSchema = z.object({
  matches: z.array(roomViewSchema),
}).strict()

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>
export type RoomMember = z.infer<typeof roomMemberSchema>
export type RoomView = z.infer<typeof roomViewSchema>
