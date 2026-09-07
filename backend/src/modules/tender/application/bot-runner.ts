import { createHash } from 'node:crypto'
import { TenderFailure } from '../domain/errors'
import { chooseBotCommand } from './bots'
import type { TenderModule } from './tender-module'
import type { TenderStore } from './tender-store'

/** Runs bounded work; game rules, receipts and optimistic commits remain owned by Tender. */
export function createTenderBotRunner({ store, tender, nowMs = () => performance.now() }: {
  store: TenderStore
  tender: TenderModule
  nowMs?: () => number
}) {
  let afterId: string | undefined
  return {
    async advance({ limit, timeBudgetMs = 250 }: { limit: number; timeBudgetMs?: number }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid bot batch limit')
      if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0 || timeBudgetMs > 1_000) throw new Error('Invalid bot time budget')
      const startedAt = nowMs()
      let ids = await store.findBotTenders({ limit, ...(afterId ? { afterId } : {}) })
      if (ids.length === 0 && afterId) ids = await store.findBotTenders({ limit })
      let acceptedCommands = 0
      let failedTenders = 0
      let processedTenders = 0
      for (const tenderId of ids) {
        // Complete an in-flight transaction, but do not start another after the budget.
        if (processedTenders > 0 && nowMs() - startedAt >= timeBudgetMs) break
        processedTenders += 1
        afterId = tenderId
        try {
          const state = await store.read(tenderId)
          if (!state || state.phase === 'complete') continue
          if (await tender.completeUnattendedBotTender(tenderId)) continue
          if (state.abandonmentDueAt !== null) continue
          for (const player of state.players) {
            if (!player.bot || state.forfeitedAtByPlayer[player.id]) continue
            const view = await tender.readTenderView({ playerId: player.id, tenderId })
            // The account/abandonment check and projection must describe the same state.
            if (view.version !== state.version) break
            const seed = `${player.bot.strategyVersion}:${tenderId}:${player.id}`
            const commandId = `bot-${createHash('sha256').update(`${seed}:${view.version}`).digest('hex')}`
            const command = chooseBotCommand(view, {
              commandId,
              difficulty: player.bot.difficulty,
              playerId: player.id,
              seed,
              strategyVersion: player.bot.strategyVersion,
            })
            if (!command) continue
            await tender.execute(command, { expectedVersion: view.version })
            acceptedCommands += 1
            break
          }
        } catch (error) {
          // Another command or deadline can win between projection and commit.
          if (error instanceof TenderFailure && [
            'tender_version_conflict', 'tender_deadline_expired', 'player_forfeited',
          ].includes(error.kind)) continue
          failedTenders += 1
        }
      }
      return { acceptedCommands, failedTenders }
    },
  }
}
