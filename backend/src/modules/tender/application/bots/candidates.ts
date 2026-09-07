import type { FieldType, Polarity, SignalId, TenderView } from '@anomaly-detector/contracts'

import { resolvePublicResult, signalIds } from '../../domain/anomaly-configuration'

type Properties = Readonly<{ fieldType: FieldType; polarity: Polarity }>

export type CandidateConfiguration = Readonly<Record<SignalId, Properties>>

export type LaboratoryObservation = {
  mode: 'broad' | 'deep' | 'impulse'
  pairs: Array<{ receiverSignal: SignalId; sourceSignal: SignalId }>
}

const properties: readonly Properties[] = [
  Object.freeze({ fieldType: 'inertial', polarity: 'positive' }),
  Object.freeze({ fieldType: 'inertial', polarity: 'negative' }),
  Object.freeze({ fieldType: 'electromagnetic', polarity: 'positive' }),
  Object.freeze({ fieldType: 'electromagnetic', polarity: 'negative' }),
  Object.freeze({ fieldType: 'phase', polarity: 'positive' }),
  Object.freeze({ fieldType: 'phase', polarity: 'negative' }),
]

const permutations = <T>(values: T[]): T[][] => values.length === 0
  ? [[]]
  : values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)])
    .map((remaining) => [value, ...remaining]))

const candidateUniverse: readonly CandidateConfiguration[] = Object.freeze(permutations([...properties]).map((assignment) =>
  Object.freeze(Object.fromEntries(signalIds.map((signalId, index) => [signalId, assignment[index]!])) as CandidateConfiguration),
))

export const candidatesFromView = (view: Pick<TenderView, 'privateMeasurements' | 'privateTheses' | 'publicScientificJournal'>) =>
  candidateUniverse.filter((candidate) => {
    for (const result of view.publicScientificJournal ?? []) {
      if (resolvePublicResult(candidate[result.sourceSignal], candidate[result.receiverSignal]) !== result.publicResult) return false
    }
    for (const measurement of view.privateMeasurements) {
      const same = candidate[measurement.sourceSignal].polarity === candidate[measurement.receiverSignal].polarity
      if ((measurement.polarityRelation === 'same') !== same) return false
    }
    for (const thesis of view.privateTheses ?? []) {
      const actual = candidate[thesis.signalId]
      if ((actual.fieldType === thesis.fieldType) !== thesis.fieldTypeCorrect) return false
      if ((actual.polarity === thesis.polarity) !== thesis.polarityCorrect) return false
    }
    return true
  })

export const candidateConsensus = (candidates: CandidateConfiguration[]) => Object.fromEntries(signalIds.map((signalId) => {
  if (candidates.length === 0) return [signalId, {}]
  const fieldTypes = [...new Set(candidates.map((candidate) => candidate[signalId].fieldType))]
  const polarities = [...new Set(candidates.map((candidate) => candidate[signalId].polarity))]
  return [signalId, {
    ...(fieldTypes.length === 1 ? { fieldType: fieldTypes[0] } : {}),
    ...(polarities.length === 1 ? { polarity: polarities[0] } : {}),
  }]
})) as Record<SignalId, Partial<Properties>>

export const candidateDirectedConsensus = (candidates: CandidateConfiguration[]) => Object.fromEntries(
  signalIds.flatMap((sourceSignal) => signalIds
    .filter((receiverSignal) => receiverSignal !== sourceSignal)
    .map((receiverSignal) => {
      const outcomes = [...new Set(candidates.map((candidate) =>
        resolvePublicResult(candidate[sourceSignal], candidate[receiverSignal]),
      ))]
      return [`${sourceSignal}:${receiverSignal}`, outcomes.length === 1 ? outcomes[0] : undefined]
    })),
) as Record<string, ReturnType<typeof resolvePublicResult> | undefined>

const observationKey = (candidate: CandidateConfiguration, action: LaboratoryObservation) => action.pairs.map((pair) => {
  const publicResult = resolvePublicResult(candidate[pair.sourceSignal], candidate[pair.receiverSignal])
  if (action.mode !== 'deep') return publicResult
  return `${publicResult}:${candidate[pair.sourceSignal].polarity === candidate[pair.receiverSignal].polarity ? 'same' : 'different'}`
}).join('|')

export const informationGain = (candidates: CandidateConfiguration[], action: LaboratoryObservation) => {
  if (candidates.length === 0) return { bits: 0, largestBucket: 0 }
  const buckets = new Map<string, number>()
  for (const candidate of candidates) {
    const key = observationKey(candidate, action)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const bits = [...buckets.values()].reduce((total, size) => {
    const probability = size / candidates.length
    return total - probability * Math.log2(probability)
  }, 0)
  return { bits, largestBucket: Math.max(...buckets.values()) }
}

export const chooseLaboratoryObservation = (
  candidates: CandidateConfiguration[],
  actions: LaboratoryObservation[],
) => actions.map((action) => ({ action, score: informationGain(candidates, action) }))
  .sort((left, right) => right.score.bits - left.score.bits
    || left.score.largestBucket - right.score.largestBucket
    || left.action.mode.localeCompare(right.action.mode)
    || JSON.stringify(left.action.pairs).localeCompare(JSON.stringify(right.action.pairs)))[0]?.action
