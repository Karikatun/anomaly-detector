import type { GameContractVersion, TenderView } from '@anomaly-detector/contracts'

import { requireSupportedTenderMode } from '../domain/errors'

export function tenderViewForClient(view: TenderView, version: GameContractVersion): TenderView {
  if (version === '2') return view
  requireSupportedTenderMode(view.game?.mode, true)

  const { game: _game, availableSamplePool: _availableSamplePool, audit, players, ...legacyView } = view
  const legacyPlayers = players.map(({ requestedAccessSlotConfirmed: _requestedAccessSlotConfirmed, ...player }) => player)
  if (audit === undefined) return { ...legacyView, players: legacyPlayers }
  const { game: _auditGame, finalSubmissionOrderByPlayer: _finalSubmissionOrderByPlayer, ...legacyAudit } = audit
  return { ...legacyView, players: legacyPlayers, audit: legacyAudit }
}
