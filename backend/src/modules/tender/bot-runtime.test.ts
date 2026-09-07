import { expect, test } from 'bun:test'
import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
import { createTenderBotRunner } from './application/bot-runner'
import { createCompletedTenderSummaryReader } from './application/tender-readers'

test('a room bot remains an explicit participant in its saved and projected Tender', async () => {
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store })
  const bot = { difficulty: 'easy' as const, strategyVersion: 'bot-v1' as const }
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot },
  ] })
  const view = await module.readTenderView({ tenderId, playerId: 'human' })
  expect(view.players.find((player) => player.playerId === 'bot')?.bot).toEqual(bot)
  expect(view.players.find((player) => player.playerId === 'bot')?.displayName).toBe('Бот · лёгкий')
  expect((await store.read(tenderId))?.players[1]?.bot).toEqual(bot)
})

test('a decision projected before another command cannot spend a bot action in a newer state', async () => {
  const module = createTenderModule()
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
  ] })
  await module.execute({ actorId: 'human', commandId: 'human-slot', tenderId, type: 'request-access-slot', slot: 6 })
  const command = { actorId: 'bot', commandId: 'stale-bot-slot', tenderId, type: 'request-access-slot' as const, slot: 5 }
  await expect(module.execute(command, { expectedVersion: 0 })).rejects.toMatchObject({ kind: 'tender_version_conflict' })
  const receipt = await module.execute(command, { expectedVersion: 1 })
  expect(await module.execute(command, { expectedVersion: 1 })).toEqual(receipt)
})

test('a server bot chooses its slot without a browser while its human still decides', async () => {
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store })
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
  ] })
  const runner = createTenderBotRunner({ store, tender: module })
  expect(await runner.advance({ limit: 10 })).toMatchObject({ acceptedCommands: 1, failedTenders: 0 })
  const saved = await store.read(tenderId)
  expect(saved?.requestedSlots.bot).toBeGreaterThan(0)
  expect(saved?.requestedSlots.human).toBeUndefined()
  expect((await runner.advance({ limit: 10 })).acceptedCommands).toBe(0)
})

test('a completed mixed Tender stays available in history but is excluded from human performance summaries', async () => {
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store })
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v1' } },
  ] })
  await module.execute({ actorId: 'human', commandId: 'forfeit', tenderId, type: 'forfeit-tender' })
  expect((await module.readTenderView({ playerId: 'human', tenderId })).phase).toBe('complete')
  expect(await store.listCompletedForPlayer('human')).toHaveLength(1)
  expect(await createCompletedTenderSummaryReader(store).listCompletedForPlayer('human')).toEqual([])
})

test('a bot with no proven final claim finishes through the ordinary authoritative deadline', async () => {
  let now = new Date('2026-09-07T12:00:00.000Z')
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store, now: () => now })
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v2' } },
  ] })
  const initial = (await store.read(tenderId))!
  await store.commit({
    tenderId, expectedVersion: initial.version, auditEvents: [],
    nextTender: { ...initial, phase: 'final-scientific-model', round: 5, dueAt: new Date(now.getTime() + 1_000) },
  })
  expect(await createTenderBotRunner({ store, tender: module }).advance({ limit: 10 }))
    .toEqual({ acceptedCommands: 0, failedTenders: 0 })
  now = new Date(now.getTime() + 1_000)
  expect((await module.advanceDueTenders({ limit: 10, now })).advancedTenderIds).toContain(tenderId)
  expect((await store.read(tenderId))?.phase).toBe('complete')
  expect((await store.read(tenderId))?.finalScientificModelsByPlayer.bot).toBeUndefined()
})

test('bot batches rotate past a broken Tender and respect their work budget without starving later matches', async () => {
  const storage = createInMemoryTenderStore()
  let elapsed = 0
  const store = {
    ...storage,
    async read(id: string) {
      elapsed += 10
      if (id === 'tender-1') throw new Error('Isolated corrupt test state')
      return storage.read(id)
    },
  }
  const module = createTenderModule({ store })
  for (let index = 0; index < 3; index += 1) {
    await module.createTender({ players: [
      { id: 'human', tiePriority: 1 },
      { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v2' } },
    ] })
  }
  const runner = createTenderBotRunner({ store, tender: module, nowMs: () => elapsed })
  expect(await runner.advance({ limit: 3, timeBudgetMs: 1 })).toEqual({ acceptedCommands: 0, failedTenders: 1 })
  expect(await runner.advance({ limit: 3, timeBudgetMs: 1 })).toEqual({ acceptedCommands: 1, failedTenders: 0 })
  expect(await runner.advance({ limit: 3, timeBudgetMs: 1 })).toEqual({ acceptedCommands: 1, failedTenders: 0 })
  expect((await storage.read('tender-2'))?.requestedSlots.bot).toBe(6)
  expect((await storage.read('tender-3'))?.requestedSlots.bot).toBe(6)
  expect(await runner.advance({ limit: 3, timeBudgetMs: 1 })).toEqual({ acceptedCommands: 0, failedTenders: 1 })
  await expect(runner.advance({ limit: 101 })).rejects.toThrow('Invalid bot batch limit')
  await expect(runner.advance({ limit: 1, timeBudgetMs: Number.NaN })).rejects.toThrow('Invalid bot time budget')
})

test('all-human leave suspends new bot decisions until resume or the ordinary abandonment deadline', async () => {
  let now = new Date('2026-09-07T12:00:00.000Z')
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store, now: () => now })
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot-a', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v2' } },
    { id: 'bot-b', tiePriority: 3, bot: { difficulty: 'hard', strategyVersion: 'bot-v2' } },
  ] })
  await module.execute({ actorId: 'human', commandId: 'leave', tenderId, type: 'leave-tender' })
  const runner = createTenderBotRunner({ store, tender: module })
  expect(await runner.advance({ limit: 10 })).toEqual({ acceptedCommands: 0, failedTenders: 0 })
  await module.execute({ actorId: 'human', commandId: 'resume', tenderId, type: 'resume-tender' })
  expect((await runner.advance({ limit: 10 })).acceptedCommands).toBe(1)
  await module.execute({ actorId: 'human', commandId: 'leave-again', tenderId, type: 'leave-tender' })
  now = new Date(now.getTime() + 5_000)
  await module.advanceDueTenders({ limit: 10, now })
  expect(await module.readTenderView({ tenderId, playerId: 'human' })).toMatchObject({
    phase: 'complete', completionReason: 'all_players_left', winnerPlayerIds: [],
  })
})

test('anonymizing the final simulated human also stops bot matches in memory', async () => {
  const store = createInMemoryTenderStore()
  const module = createTenderModule({ store })
  const { tenderId } = await module.createTender({ players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion: 'bot-v2' } },
  ] })
  await module.anonymizeParticipant('human')
  expect(await createTenderBotRunner({ store, tender: module }).advance({ limit: 10 }))
    .toEqual({ acceptedCommands: 0, failedTenders: 0 })
  expect(await module.readTenderView({ tenderId, playerId: 'bot' })).toMatchObject({
    phase: 'complete', completionReason: 'no_human_players', winnerPlayerIds: [],
  })
})
