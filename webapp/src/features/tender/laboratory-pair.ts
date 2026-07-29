import type { SignalId, TenderView } from '@anomaly-detector/contracts'

export const isLaboratoryPairResearched = ({
  journal,
  playerId,
  receiverSignal,
  sourceSignal,
}: {
  journal: TenderView['publicScientificJournal']
  playerId: string
  receiverSignal: SignalId
  sourceSignal: SignalId
}) => journal?.some((entry) =>
  entry.playerId === playerId
  && entry.sourceSignal === sourceSignal
  && entry.receiverSignal === receiverSignal,
) ?? false
