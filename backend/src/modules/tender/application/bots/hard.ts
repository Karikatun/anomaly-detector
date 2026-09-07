import type { FieldType, Polarity, ScientificModel, SignalId, TenderView } from '@anomaly-detector/contracts'

import { resolvePublicResult, signalIds } from '../../domain/anomaly-configuration'
import type { CandidateConfiguration } from './candidates'
import { informationGain } from './candidates'

const seededValue = (seed: string) => {
  let value = 2_166_136_261
  for (const character of seed) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16_777_619)
  }
  return value >>> 0
}

export type PairedRatingSummary = {
  losses: number
  meanDelta: number
  sampleSize: number
  standardError: number
  wins: number
}

export const summarizePairedRatings = (deltas: number[]): PairedRatingSummary => {
  if (deltas.length === 0) return { losses: 0, meanDelta: 0, sampleSize: 0, standardError: 0, wins: 0 }
  const meanDelta = deltas.reduce((total, delta) => total + delta, 0) / deltas.length
  const variance = deltas.length < 2 ? 0 : deltas.reduce((total, delta) => total + (delta - meanDelta) ** 2, 0) / (deltas.length - 1)
  return {
    losses: deltas.filter((delta) => delta < 0).length,
    meanDelta,
    sampleSize: deltas.length,
    standardError: Math.sqrt(variance / deltas.length),
    wins: deltas.filter((delta) => delta > 0).length,
  }
}

const asScientificModel = (candidate: CandidateConfiguration): ScientificModel => ({
  signals: Object.fromEntries(signalIds.map((signalId) => [signalId, candidate[signalId]])),
})

type FinalModelScore = {
  complete: Map<string, number>
  exact: Map<string, number>
  field: Map<string, number>
  polarity: Map<string, number>
}

const claimKey = (fieldType: string, polarity: string) => `${fieldType}:${polarity}`

const modelKey = (model: ScientificModel) => signalIds.map((signalId) => {
  const claim = model.signals[signalId]
  return claim ? claimKey(claim.fieldType ?? '', claim.polarity ?? '') : ''
}).join('|')

const scoreTable = (candidates: CandidateConfiguration[]): FinalModelScore => {
  const complete = new Map<string, number>()
  const exact = new Map<string, number>()
  const field = new Map<string, number>()
  const polarity = new Map<string, number>()
  for (const candidate of candidates) {
    complete.set(modelKey(asScientificModel(candidate)), (complete.get(modelKey(asScientificModel(candidate))) ?? 0) + 1)
    for (const signalId of signalIds) {
      const claim = candidate[signalId]
      const fieldKey = `${signalId}:${claim.fieldType}`
      const polarityKey = `${signalId}:${claim.polarity}`
      const exactKey = `${signalId}:${claimKey(claim.fieldType, claim.polarity)}`
      field.set(fieldKey, (field.get(fieldKey) ?? 0) + 1)
      polarity.set(polarityKey, (polarity.get(polarityKey) ?? 0) + 1)
      exact.set(exactKey, (exact.get(exactKey) ?? 0) + 1)
    }
  }
  return { complete, exact, field, polarity }
}

const expectedRating = (table: FinalModelScore, size: number, model: ScientificModel) => signalIds.reduce((total, signalId) => {
  const claim = model.signals[signalId]
  if (!claim) return total
  return total
    + (table.field.get(`${signalId}:${claim.fieldType}`) ?? 0) / size
    + (table.polarity.get(`${signalId}:${claim.polarity}`) ?? 0) / size
    + (table.exact.get(`${signalId}:${claimKey(claim.fieldType ?? '', claim.polarity ?? '')}`) ?? 0) / size
}, 0) + (signalIds.filter((signalId) => model.signals[signalId]).length === signalIds.length
  ? ((table.complete.get(modelKey(model)) ?? 0) / size) * 3
  : 0)

export const expectedFinalModelRating = (candidates: CandidateConfiguration[], model: ScientificModel) => {
  if (candidates.length === 0) return 0
  return expectedRating(scoreTable(candidates), candidates.length, model)
}

const modalModel = (candidates: CandidateConfiguration[], table: FinalModelScore): ScientificModel => ({
  signals: Object.fromEntries(signalIds.map((signalId) => {
    const best = [...new Set(candidates.map((candidate) => claimKey(candidate[signalId].fieldType, candidate[signalId].polarity)))]
      .sort((left, right) => (table.exact.get(`${signalId}:${right}`) ?? 0)
        - (table.exact.get(`${signalId}:${left}`) ?? 0)
        || left.localeCompare(right))[0]!
    const [fieldType, polarity] = best.split(':')
    return [signalId, { fieldType, polarity }]
  })),
})

export const chooseHardFinalModel = (candidates: CandidateConfiguration[], seed: string): ScientificModel => {
  if (candidates.length === 0) return { signals: {} }
  const table = scoreTable(candidates)
  const models = [...candidates.map(asScientificModel), modalModel(candidates, table)]
  return models.map((model) => ({ model, rating: expectedRating(table, candidates.length, model) }))
    .sort((left, right) => right.rating - left.rating
      || seededValue(`${seed}:${JSON.stringify(left.model)}`) - seededValue(`${seed}:${JSON.stringify(right.model)}`))[0]!.model
}

export const chooseHardThesis = (
  view: TenderView,
  playerId: string,
  candidates: CandidateConfiguration[],
  submitted: SignalId[],
): { fieldType: FieldType; polarity: Polarity; signalId: SignalId } | undefined => {
  if (candidates.length === 0) return undefined
  const certified = new Set((view.privateTheses ?? []).filter((thesis) => thesis.fullyCorrect).map((thesis) => thesis.signalId))
  const choices = signalIds.flatMap((signalId) => [...new Set(candidates.map((candidate) => claimKey(
    candidate[signalId].fieldType,
    candidate[signalId].polarity,
  )))].map((key) => {
    const [fieldType, polarity] = key.split(':') as [FieldType, Polarity]
    const correct = candidates.filter((candidate) => candidate[signalId].fieldType === fieldType
      && candidate[signalId].polarity === polarity).length / candidates.length
    const contractValue = view.publicContracts.filter((contract) => !contract.reservedByPlayerId
      && !contract.bidOutcome && contract.targetSignal === signalId).reduce((total, contract) => total + (contract.ratingReward ?? 0), 0)
    return { contractValue, correct, fieldType, polarity, signalId }
  })).filter((choice) => !submitted.includes(choice.signalId) && !certified.has(choice.signalId))
  const selected = choices.sort((left, right) => right.correct - left.correct
    || right.contractValue - left.contractValue
    || left.signalId.localeCompare(right.signalId)
    || left.fieldType.localeCompare(right.fieldType)
    || left.polarity.localeCompare(right.polarity))[0]
  return selected && {
    fieldType: selected.fieldType,
    polarity: selected.polarity,
    signalId: selected.signalId,
  }
}

export const chooseHardLaboratoryPair = (view: TenderView, playerId: string, candidates: CandidateConfiguration[]) => {
  if (candidates.length === 0) return undefined
  const samples = [...new Set(view.privateSamples)]
  const researched = new Set((view.publicScientificJournal ?? []).filter((entry) => entry.playerId === playerId)
    .map((entry) => `${entry.sourceSignal}:${entry.receiverSignal}`))
  const pairs = samples.flatMap((sourceSignal) => samples.filter((receiverSignal) => receiverSignal !== sourceSignal)
    .map((receiverSignal) => ({ receiverSignal, sourceSignal }))
    .filter((pair) => !researched.has(`${pair.sourceSignal}:${pair.receiverSignal}`)))
  const expectedContractRating = (pair: typeof pairs[number]) => view.publicContracts.reduce((total, contract) => {
    if (contract.reservedByPlayerId || contract.bidOutcome || contract.kind === 'scientific') return total
    const target = contract.targetRole === 'receiver' ? pair.receiverSignal : pair.sourceSignal
    if (target !== contract.targetSignal) return total
    const accepted = new Set([contract.requiredPublicResult, contract.requiredSecondaryPublicResult])
    const probability = candidates.filter((candidate) => accepted.has(
      resolvePublicResult(candidate[pair.sourceSignal], candidate[pair.receiverSignal]),
    )).length / candidates.length
    return total + probability * (contract.ratingReward ?? 0)
  }, 0)
  return pairs.map((pair) => ({
    pair,
    contractRating: expectedContractRating(pair),
    information: informationGain(candidates, { mode: 'deep', pairs: [pair] }).bits,
  })).sort((left, right) => right.contractRating - left.contractRating
    || right.information - left.information
    || `${left.pair.sourceSignal}:${left.pair.receiverSignal}`.localeCompare(`${right.pair.sourceSignal}:${right.pair.receiverSignal}`))[0]?.pair
}
