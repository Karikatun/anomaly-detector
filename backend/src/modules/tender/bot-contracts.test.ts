import { expect, test } from 'bun:test'

import { createTenderModule } from './index'
import { chooseBotCommand } from './application/bots'
import { createTenderBotRunner } from './application/bot-runner'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

const createContractTurn = async ({
  difficulty = 'easy', strategyVersion = 'bot-v2', reserved = false, final = false,
}: {
  difficulty?: 'easy' | 'hard' | 'human'
  strategyVersion?: 'bot-v1' | 'bot-v2'
  reserved?: boolean
  final?: boolean
} = {}) => {
  let now = new Date('2026-09-10T00:00:00.000Z')
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, now: () => now })
  const { tenderId } = await tender.createTender({ players: [
    { id: 'participant', tiePriority: 1, ...(difficulty === 'human' ? {} : { bot: { difficulty, strategyVersion } }) },
    { id: 'human', tiePriority: 2 },
  ] })
  const initial = (await store.read(tenderId))!
  const contract = {
    ...(final ? initial.publicFinalContract : initial.publicContracts[0]!),
    contractId: final ? 'final-contract' : 'round-5-contract-1',
    kind: final ? 'final' as const : 'light' as const,
    targetSignal: 'aster' as const,
    targetRole: 'source' as const,
    requiredPublicResult: 'reflection' as const,
    ...(reserved ? { reservedByPlayerId: 'participant' } : {}),
  }
  // Represents a saved turn from before the easy-bot restriction was enforced.
  await store.commit({
    tenderId, expectedVersion: initial.version, auditEvents: [],
    nextTender: {
      ...initial, round: 5, phase: 'contracts', dueAt: new Date(now.getTime() + 1_000),
      accessSlots: { participant: 1, human: 2 },
      corporateTrustByPlayer: { participant: 3, human: 3 },
      powerAllocations: Object.fromEntries(['participant', 'human'].map((playerId) => [
        playerId, { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 3 },
      ])),
      publicContracts: final ? [] : [contract],
      publicFinalContract: final ? contract : initial.publicFinalContract,
      publicScientificJournal: ['participant', 'human'].map((playerId) => ({
        playerId, protocol: 'continuous', publicResult: 'reflection',
        receiverSignal: 'boreal', sourceSignal: 'aster', testId: `r5-${playerId}`,
      })),
    },
  })
  return {
    contractId: contract.contractId, store, tender, tenderId,
    expire: () => { now = new Date(now.getTime() + 1_000); return now },
  }
}

const savedEasyTurns = (['bot-v1', 'bot-v2'] as const).flatMap((strategyVersion) =>
  [false, true].flatMap((final) => [false, true].map((reserved) => ({ strategyVersion, final, reserved }))),
)

test.each(savedEasyTurns)('easy $strategyVersion chooses no Contract command in a saved turn: final=$final reserved=$reserved', async (options) => {
  const { tender, tenderId, contractId } = await createContractTurn(options)
  const view = await tender.readTenderView({ tenderId, playerId: 'participant' })
  const contract = [...view.publicContracts, view.publicFinalContract!].find((candidate) => candidate.contractId === contractId)!
  expect(contract.planning?.eligible).toBe(true)
  expect(view.activePlayerId).toBe('participant')
  expect(chooseBotCommand(view, {
    commandId: 'easy-contract', difficulty: 'easy', playerId: 'participant',
    seed: 'easy-contract', strategyVersion: options.strategyVersion,
  })).toBeNull()
})

test.each(savedEasyTurns)('Tender rejects easy $strategyVersion Contract commands: final=$final reserved=$reserved', async (options) => {
  const { tender, tenderId, contractId } = await createContractTurn(options)
  const before = await tender.readTenderView({ tenderId, playerId: 'participant' })
  await expect(tender.execute({
    actorId: 'participant', commandId: 'forbidden-contract', tenderId, contractId,
    ...(options.reserved
      ? { type: 'submit-contract-bid' as const, evidenceTestIds: ['r5-participant'] }
      : { type: 'reserve-contract' as const }),
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
  expect(await tender.readTenderView({ tenderId, playerId: 'participant' })).toEqual(before)
})

test.each(savedEasyTurns)('saved easy $strategyVersion Contract turn expires without blocking humans: final=$final reserved=$reserved', async (options) => {
  const { tender, tenderId, contractId, store, expire } = await createContractTurn(options)
  expect(await createTenderBotRunner({ store, tender }).advance({ limit: 10 }))
    .toEqual({ acceptedCommands: 0, failedTenders: 0 })
  expect((await tender.advanceDueTenders({ limit: 10, now: expire() })).advancedTenderIds).toEqual([tenderId])
  const view = await tender.readTenderView({ tenderId, playerId: 'human' })
  expect(view.activePlayerId).toBe('human')
  expect(view.players.find((player) => player.playerId === 'participant')?.rating).toBe(0)
  const contract = [...view.publicContracts, view.publicFinalContract!].find((candidate) => candidate.contractId === contractId)!
  expect(contract.reservedByPlayerId).toBeUndefined()
  expect(contract.awardedToPlayerId).toBeUndefined()
  await tender.execute({ actorId: 'human', commandId: 'human-reserve', tenderId, contractId, type: 'reserve-contract' })
  await tender.execute({ actorId: 'human', commandId: 'human-bid', tenderId, contractId, type: 'submit-contract-bid', evidenceTestIds: ['r5-human'] })
  expect((await tender.readTenderView({ tenderId, playerId: 'human' })).phase).toBe('final-scientific-model')
})

test.each(['hard', 'human'] as const)('%s participants still reserve and complete eligible Contracts', async (difficulty) => {
  for (const final of [false, true]) {
    const { tender, tenderId, contractId } = await createContractTurn({ difficulty, final })
    await tender.execute({ actorId: 'participant', commandId: 'allowed-reserve', tenderId, contractId, type: 'reserve-contract' })
    const receipt = await tender.execute({
      actorId: 'participant', commandId: 'allowed-bid', tenderId, contractId,
      type: 'submit-contract-bid', evidenceTestIds: ['r5-participant'],
    })
    expect(await tender.execute({
      actorId: 'participant', commandId: 'allowed-bid', tenderId, contractId,
      type: 'submit-contract-bid', evidenceTestIds: ['r5-participant'],
    })).toEqual(receipt)
    const view = await tender.readTenderView({ tenderId, playerId: 'human' })
    const contract = [...view.publicContracts, view.publicFinalContract!].find((candidate) => candidate.contractId === contractId)!
    expect(contract.awardedToPlayerId).toBe('participant')
    expect(view.players.find((player) => player.playerId === 'participant')?.rating).toBeGreaterThan(0)
  }
})
