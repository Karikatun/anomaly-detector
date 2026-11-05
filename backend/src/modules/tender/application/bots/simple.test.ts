import { expect, test } from 'bun:test'
import { createTenderModule } from '../../index'
import { chooseBotCommand } from './index'

for (const difficulty of ['easy', 'hard'] as const) test(`simple ${difficulty} follows three legal rounds and explicitly submits a full model`, async () => {
  const tender = createTenderModule({ seedGenerator: () => 'simple-policy-test' })
  const { tenderId } = await tender.createTender({ mode: 'simple', players: [
    { id: 'human', tiePriority: 1 },
    { id: 'bot', tiePriority: 2, bot: { difficulty, strategyVersion: 'bot-simple-v1' } },
  ] })
  for (let ordinal = 0; ordinal < 150; ordinal++) {
    let moved = false
    for (const playerId of ['human', 'bot']) {
      const view = await tender.readTenderView({ playerId, tenderId })
      if (view.phase === 'complete') {
        expect(view.round).toBe(3)
        expect(view.audit?.rounds).toHaveLength(3)
        expect(Object.keys(view.audit!.finalScientificModelsByPlayer.bot!.signals)).toHaveLength(6)
        return
      }
      const command = chooseBotCommand(view, { commandId: `cmd-${ordinal}-${playerId}`, difficulty,
        playerId, seed: `independent-choice-${playerId}`, strategyVersion: 'bot-simple-v1' })
      if (!command) continue
      expect(command.type).not.toMatch(/contract/)
      if (command.type === 'allocate-power') {
        expect(command.allocation.contracts).toBe(0)
        expect(Object.values(command.allocation).reduce((a, b) => a + b, 0)).toBe(4)
      }
      await tender.execute(command, { expectedVersion: view.version })
      moved = true
      break
    }
    expect(moved).toBe(true)
  }
  throw new Error('Simple policy exceeded command bound')
})

test('bot strategies cannot silently cross the immutable simple/standard boundary', async () => {
  const tender = createTenderModule()
  for (const [mode, strategyVersion] of [['simple', 'bot-v1'], ['simple', 'bot-v2'], ['standard', 'bot-simple-v1']] as const) {
    await expect(tender.createTender({ mode, players: [{ id: 'human', tiePriority: 1 },
      { id: 'bot', tiePriority: 2, bot: { difficulty: 'easy', strategyVersion } }] })).rejects.toMatchObject({ kind: 'invalid_create_tender' })
  }
})
