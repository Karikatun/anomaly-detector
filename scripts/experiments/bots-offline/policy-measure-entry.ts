// This entry deliberately executes every currently supported strategy branch.
// Assigning results to globalThis keeps Bun from replacing it with an inert export.
import type { TenderView } from '@anomaly-detector/contracts'

import { chooseBotCommand } from '../../../backend/src/modules/tender/application/bots'

const view = {
  activePlayerId: 'bot',
  hasForfeited: false,
  hasLeft: false,
  phase: 'power-allocation',
  players: [{ budget: 3, forfeited: false, playerId: 'bot', powerAllocationConfirmed: false }],
  privateSamples: [],
  round: 1,
  tenderId: 'local-policy-measurement',
} as TenderView

globalThis.__offlineBotPolicyMeasurement = [
  chooseBotCommand(view, { commandId: 'v1', difficulty: 'easy', playerId: 'bot', seed: 'measure', strategyVersion: 'bot-v1' }),
  chooseBotCommand(view, { commandId: 'v2-easy', difficulty: 'easy', playerId: 'bot', seed: 'measure', strategyVersion: 'bot-v2' }),
  chooseBotCommand(view, { commandId: 'v2-hard', difficulty: 'hard', playerId: 'bot', seed: 'measure', strategyVersion: 'bot-v2' }),
]

declare global {
  // The measurement entry owns this temporary global; it is never production code.
  var __offlineBotPolicyMeasurement: unknown[]
}
