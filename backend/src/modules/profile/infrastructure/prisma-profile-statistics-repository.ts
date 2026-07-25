import { z } from 'zod'

import type { DbClient } from '../../../db'
import type {
  CompletedProfileMatch,
  ProfileStatisticsRepository,
} from '../application/ports'

const playerSchema = z.object({ id: z.string() }).passthrough()
const compatibleStateSchema = z.object({
  budgetByPlayer: z.record(z.string(), z.number()),
  players: z.array(playerSchema).min(2),
  publicTheses: z.array(z.object({
    correct: z.boolean(),
    playerId: z.string(),
  }).passthrough()),
  ratingByPlayer: z.record(z.string(), z.number()),
  winnerPlayerIds: z.array(z.string()),
}).passthrough()

const scientificModelEventSchema = z.object({
  kind: z.literal('scientific_model_scored'),
  payload: z.object({
    correctProperties: z.number().int().min(0).max(12),
    playerId: z.string(),
  }).passthrough(),
})

const contractEventSchema = z.object({
  kind: z.literal('contract_bid_assessed'),
  payload: z.object({
    awarded: z.boolean(),
    playerId: z.string(),
  }).passthrough(),
})

const profileAuditEventSchema = z.discriminatedUnion('kind', [
  scientificModelEventSchema,
  contractEventSchema,
])

export function createPrismaProfileStatisticsRepository(db: DbClient): ProfileStatisticsRepository {
  return {
    async listCompletedMatches(userId) {
      const rooms = await db.tenderRoom.findMany({
        where: {
          members: { some: { userId } },
          status: 'started',
          tender: { is: { phase: 'complete' } },
        },
        select: {
          tender: {
            select: {
              auditEvents: {
                where: {
                  kind: { in: ['contract_bid_assessed', 'scientific_model_scored'] },
                },
                select: { kind: true, payload: true },
              },
              state: true,
            },
          },
        },
      })

      return rooms.flatMap((room) => {
        if (!room.tender) return []
        const stateResult = compatibleStateSchema.safeParse(room.tender.state)
        const eventsResult = z.array(profileAuditEventSchema).safeParse(room.tender.auditEvents)
        if (!stateResult.success || !eventsResult.success) return []

        const state = stateResult.data
        const playerIds = new Set(state.players.map((player) => player.id))
        if (
          playerIds.size !== state.players.length
          || !playerIds.has(userId)
          || !state.players.every((player) =>
            state.ratingByPlayer[player.id] !== undefined
            && state.budgetByPlayer[player.id] !== undefined)
          || state.winnerPlayerIds.length === 0
          || !state.winnerPlayerIds.every((playerId) => playerIds.has(playerId))
          || !state.publicTheses.every((thesis) => playerIds.has(thesis.playerId))
          || !eventsResult.data.every((event) => playerIds.has(event.payload.playerId))
        ) return []

        let correctModelProperties = 0
        let submittedContracts = 0
        let successfulContracts = 0
        for (const event of eventsResult.data) {
          if (event.payload.playerId !== userId) continue
          if (event.kind === 'scientific_model_scored') {
            correctModelProperties += event.payload.correctProperties
          } else {
            submittedContracts += 1
            successfulContracts += Number(event.payload.awarded)
          }
        }

        const match: CompletedProfileMatch = {
          players: state.players.map((player) => ({
            budget: state.budgetByPlayer[player.id] ?? 0,
            correctTheses: state.publicTheses.filter((thesis) =>
              thesis.playerId === player.id && thesis.correct).length,
            playerId: player.id,
            rating: state.ratingByPlayer[player.id] ?? 0,
          })),
          playerResult: {
            correctModelProperties,
            submittedContracts,
            successfulContracts,
          },
          winnerPlayerIds: state.winnerPlayerIds,
        }
        return [match]
      })
    },
  }
}
