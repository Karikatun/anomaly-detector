import type { SignalId, TenderView } from '@anomaly-detector/contracts'

type LaboratoryPair = {
  receiverSignal: SignalId
  sourceSignal: SignalId
}

export const areLaboratoryPairsEqual = (
  first: LaboratoryPair,
  second: LaboratoryPair,
) => first.sourceSignal === second.sourceSignal && first.receiverSignal === second.receiverSignal

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
