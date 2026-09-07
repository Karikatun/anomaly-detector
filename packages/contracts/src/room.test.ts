import { expect, test } from 'bun:test'

import {
  addRoomBotRequestSchema,
  createRoomRequestSchema,
  joinRoomByCodeRequestSchema,
  roomJoinCodeSchema,
  roomViewSchema,
  setRoomReadyRequestSchema,
  updateRoomBotDifficultyRequestSchema,
} from './room'

test('Room contracts accept a waiting private room for two to four players', () => {
  expect(createRoomRequestSchema.parse({ capacity: 3 })).toEqual({ capacity: 3, allowBots: false })
  expect(createRoomRequestSchema.parse({ allowBots: true, capacity: 3 })).toEqual({
    allowBots: true,
    capacity: 3,
  })
  expect(() => createRoomRequestSchema.parse({ capacity: 5 })).toThrow()
  expect(roomViewSchema.parse({
    capacity: 3,
    allowBots: true,
    bots: [{
      difficulty: 'easy',
      id: '019f8099-7e26-7760-ad08-66d1d66b2720',
      seat: 2,
    }],
    hostId: '019f8099-7e26-7760-ad08-66d1d66b2717',
    members: [{
      displayName: 'Исследователь',
      ready: false,
      seat: 1,
      userId: '019f8099-7e26-7760-ad08-66d1d66b2718',
    }],
    joinCode: '7K9M2NP4RX',
    roomId: '019f8099-7e26-7760-ad08-66d1d66b2719',
    serverTime: '2026-07-26T12:00:00.000Z',
    status: 'waiting',
    tenderPlacement: 2,
  })).toMatchObject({ capacity: 3, serverTime: '2026-07-26T12:00:00.000Z', status: 'waiting' })
  expect(() => roomViewSchema.parse({
    capacity: 2,
    hostId: '019f8099-7e26-7760-ad08-66d1d66b2717',
    joinCode: '7K9M2NP4RX',
    members: [{ ready: false, seat: 1, userId: '019f8099-7e26-7760-ad08-66d1d66b2718' }],
    roomId: '019f8099-7e26-7760-ad08-66d1d66b2719',
    serverTime: '2026-07-26T12:00:00.000Z',
    status: 'waiting',
  })).toThrow()
  expect(setRoomReadyRequestSchema.parse({ ready: true })).toEqual({ ready: true })
  expect(addRoomBotRequestSchema.parse({ difficulty: 'easy', seat: 3 })).toEqual({ difficulty: 'easy', seat: 3 })
  expect(() => addRoomBotRequestSchema.parse({ difficulty: 'hard', seat: 3 })).toThrow()
  expect(() => addRoomBotRequestSchema.parse({ difficulty: 'easy', seat: 5 })).toThrow()
  expect(updateRoomBotDifficultyRequestSchema.parse({ difficulty: 'easy' })).toEqual({ difficulty: 'easy' })
  expect(updateRoomBotDifficultyRequestSchema.parse({ difficulty: 'hard' })).toEqual({ difficulty: 'hard' })
  expect(() => updateRoomBotDifficultyRequestSchema.parse({ difficulty: 'medium' })).toThrow()
  expect(() => updateRoomBotDifficultyRequestSchema.parse({ difficulty: 'hard', seat: 4 })).toThrow()
})

test('Room join codes accept an unambiguous uppercase code and normalize pasted separators', () => {
  expect(roomJoinCodeSchema.parse('7K9M2NP4RX')).toBe('7K9M2NP4RX')
  expect(joinRoomByCodeRequestSchema.parse({ code: ' 7k9m-2np4-rx ' })).toEqual({
    code: '7K9M2NP4RX',
  })
  expect(() => joinRoomByCodeRequestSchema.parse({
    code: ' 019f8099-7e26-7760-ad08-66d1d66b2719 ',
  })).toThrow()
  expect(() => roomJoinCodeSchema.parse('7K9M2NP4RO')).toThrow()
  expect(() => joinRoomByCodeRequestSchema.parse({ code: '7K9M2NP4' })).toThrow()
})
