import { expect, test } from 'bun:test'
import type { TenderView } from '@anomaly-detector/contracts'

import { createTenderModule } from '../../index'
import { chooseBotCommand } from './index'

type Difficulty = 'easy' | 'hard'
type Participant = { difficulty?: Difficulty; id: string; kind: 'bot' | 'human' }

const compositions: Array<{ name: string; participants: Participant[] }> = [
  { name: 'one human and one easy bot', participants: [{ id: 'human-1', kind: 'human' }, { difficulty: 'easy', id: 'bot-1', kind: 'bot' }] },
  { name: 'one human and two mixed bots', participants: [{ id: 'human-1', kind: 'human' }, { difficulty: 'easy', id: 'bot-1', kind: 'bot' }, { difficulty: 'hard', id: 'bot-2', kind: 'bot' }] },
  { name: 'two humans and one hard bot', participants: [{ id: 'human-1', kind: 'human' }, { id: 'human-2', kind: 'human' }, { difficulty: 'hard', id: 'bot-1', kind: 'bot' }] },
  { name: 'one human and three mixed bots', participants: [{ id: 'human-1', kind: 'human' }, { difficulty: 'easy', id: 'bot-1', kind: 'bot' }, { difficulty: 'hard', id: 'bot-2', kind: 'bot' }, { difficulty: 'easy', id: 'bot-3', kind: 'bot' }] },
  { name: 'two humans and two mixed bots', participants: [{ id: 'human-1', kind: 'human' }, { difficulty: 'hard', id: 'bot-1', kind: 'bot' }, { id: 'human-2', kind: 'human' }, { difficulty: 'easy', id: 'bot-2', kind: 'bot' }] },
  { name: 'three humans and one hard bot', participants: [{ id: 'human-1', kind: 'human' }, { id: 'human-2', kind: 'human' }, { id: 'human-3', kind: 'human' }, { difficulty: 'hard', id: 'bot-1', kind: 'bot' }] },
]

const play = async (composition: typeof compositions[number], order: 'forward' | 'rotated') => {
  let now = new Date('2026-09-07T00:00:00.000Z')
  const participants = order === 'forward'
    ? composition.participants
    : [...composition.participants.slice(1), composition.participants[0]!]
  const seed = `mixed:${composition.name}:${order}`
  const tender = createTenderModule({ now: () => now, seedGenerator: () => seed })
  const { tenderId } = await tender.createTender({
    players: participants.map((participant, index) => ({
      ...(participant.kind === 'bot' ? { bot: { difficulty: participant.difficulty!, strategyVersion: 'bot-v2' as const } } : {}),
      id: participant.id,
      tiePriority: index + 1,
    })),
  })

  for (let step = 0; step < 300; step += 1) {
    const views = await Promise.all(participants.map(async (participant) => ({
      participant,
      view: await tender.readTenderView({ playerId: participant.id, tenderId }),
    })))
    if (views.every(({ view }) => view.phase === 'complete')) break
    const command = views.map(({ participant, view }) => chooseBotCommand(view, {
      commandId: `mixed:${order}:${step}:${participant.id}`,
      difficulty: participant.difficulty ?? 'easy',
      playerId: participant.id,
      seed: `decision:${seed}:${participant.id}`,
      strategyVersion: participant.kind === 'bot' ? 'bot-v2' : 'bot-v1',
    })).find((candidate) => candidate !== null)
    if (command) await tender.execute(command)
    else {
      now = new Date(now.getTime() + 120_000)
      await tender.advanceDueTenders({ limit: 10, now })
    }
  }
  return { participants, view: await tender.readTenderView({ playerId: participants[0]!.id, tenderId }) }
}

const seatPermutations = compositions.flatMap((composition) => (['forward', 'rotated'] as const)
  .map((order) => ({ composition, order })))

test.each(seatPermutations)('mixed five-round game completes legally: $composition.name / $order', async ({ composition, order }) => {
  const { participants, view } = await play(composition, order)

  expect(view.phase).toBe('complete')
  expect(view.round).toBe(5)
  expect(view.audit?.rounds).toHaveLength(5)
  for (const participant of participants.filter((candidate) => candidate.kind === 'bot')) {
    const projected = view.players.find((player) => player.playerId === participant.id)
    expect(projected?.bot).toEqual({ difficulty: participant.difficulty!, strategyVersion: 'bot-v2' })
    expect(projected?.displayName).toBe(`Бот · ${participant.difficulty === 'easy' ? 'лёгкий' : 'сложный'}`)
    expect(view.audit?.ratingBreakdownByPlayer[participant.id]?.total).toBe(projected?.rating)
    expect(view.audit?.finalScientificModelsByPlayer[participant.id]).toMatchObject({ submitted: expect.any(Boolean) })
  }
})

test('one participant private evidence cannot alter another participant projected decision', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'private-decision-isolation' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'bot-a', tiePriority: 1, bot: { difficulty: 'hard', strategyVersion: 'bot-v2' } },
      { id: 'bot-b', tiePriority: 2, bot: { difficulty: 'hard', strategyVersion: 'bot-v2' } },
    ],
  })
  const view = await tender.readTenderView({ playerId: 'bot-b', tenderId })
  const options = {
    commandId: 'private-isolation', difficulty: 'hard' as const, playerId: 'bot-b', seed: 'bot-b-decision', strategyVersion: 'bot-v2' as const,
  }
  const polluted = {
    ...view,
    privateEvidenceForAnotherParticipant: {
      playerId: 'bot-a',
      thesis: { fieldType: 'phase', polarity: 'negative', signalId: 'ferro' },
      workingModel: { signals: { ferro: { hypothesis: { fieldType: 'phase', polarity: 'negative' } } } },
    },
  } as TenderView

  expect(Object.keys(view)).not.toContain('privateEvidenceForAnotherParticipant')
  expect(chooseBotCommand(polluted, options)).toEqual(chooseBotCommand(view, options))
})
