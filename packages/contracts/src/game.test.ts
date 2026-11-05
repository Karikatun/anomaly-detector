import { expect, test } from 'bun:test'
import { createRoomRequestSchema } from './room'
import { gameDescriptorSchema } from './game'

test('accepts simple human and bot-enabled rooms', () => {
  expect(createRoomRequestSchema.parse({ capacity: 2, mode: 'simple' })).toEqual({
    allowBots: false, capacity: 2, mode: 'simple',
  })
  expect(createRoomRequestSchema.safeParse({ capacity: 2, mode: 'simple', allowBots: true }).success).toBe(true)
  expect(createRoomRequestSchema.safeParse({ capacity: 2, mode: 'unknown' }).success).toBe(false)
})

test('rejects unknown modes and contradictory immutable descriptors', () => {
  expect(gameDescriptorSchema.safeParse({ mode: 'simple', rounds: 5, powerPerRound: 4, contracts: true, scoring: 'standard' }).success).toBe(false)
  expect(gameDescriptorSchema.safeParse({ mode: 'unknown', rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' }).success).toBe(false)
  expect(createRoomRequestSchema.safeParse({ capacity: 2, mode: 'simple', game: { contracts: true } }).success).toBe(false)
})
