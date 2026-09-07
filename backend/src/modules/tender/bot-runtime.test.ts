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
