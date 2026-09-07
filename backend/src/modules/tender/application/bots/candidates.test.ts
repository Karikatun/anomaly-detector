import { expect, test } from 'bun:test'

import { candidateConsensus, candidatesFromView, chooseLaboratoryObservation, informationGain } from './candidates'

test('filters a literal public result and own false thesis components without hidden configuration', () => {
  const candidates = candidatesFromView({
    privateMeasurements: [{ polarityRelation: 'same', receiverSignal: 'boreal', sourceSignal: 'aster' }],
    privateTheses: [{
      fieldType: 'inertial',
      fieldTypeCorrect: false,
      fullyCorrect: false,
      id: 'false-component',
      polarity: 'positive',
      polarityCorrect: false,
      round: 1,
      signalId: 'aster',
    }],
    publicScientificJournal: [{
      playerId: 'other-player',
      protocol: 'continuous',
      publicResult: 'reflection',
      receiverSignal: 'boreal',
      sourceSignal: 'aster',
      testId: 'public-result',
    }],
  })

  expect(candidates).toHaveLength(48)
  expect(candidates.every((candidate) => candidate.aster.fieldType !== 'inertial' && candidate.aster.polarity !== 'positive')).toBe(true)
  expect(candidateConsensus(candidates).aster).toEqual({ polarity: 'negative' })
})

test('keeps contradictory projected observations empty instead of inventing a claim', () => {
  const candidates = candidatesFromView({
    privateMeasurements: [],
    privateTheses: [{
      fieldType: 'inertial',
      fieldTypeCorrect: true,
      fullyCorrect: false,
      id: 'contradiction-a',
      polarity: 'positive',
      polarityCorrect: true,
      round: 1,
      signalId: 'aster',
    }, {
      fieldType: 'inertial',
      fieldTypeCorrect: false,
      fullyCorrect: false,
      id: 'contradiction-b',
      polarity: 'positive',
      polarityCorrect: true,
      round: 1,
      signalId: 'aster',
    }],
    publicScientificJournal: [],
  })

  expect(candidates).toEqual([])
  expect(candidateConsensus(candidates).aster).toEqual({})
})

test('selects the literal highest-information legal broad action with its known partition', () => {
  const candidates = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] })
  const deep = { mode: 'deep' as const, pairs: [{ receiverSignal: 'boreal' as const, sourceSignal: 'aster' as const }] }
  const broad = {
    mode: 'broad' as const,
    pairs: [
      { receiverSignal: 'boreal' as const, sourceSignal: 'aster' as const },
      { receiverSignal: 'cinder' as const, sourceSignal: 'aster' as const },
    ],
  }

  expect(informationGain(candidates, deep)).toEqual({ bits: 2.321928094887362, largestBucket: 144 })
  expect(informationGain(candidates, broad)).toEqual({ bits: 3.621928094887362, largestBucket: 72 })
  expect(chooseLaboratoryObservation(candidates, [deep, broad])).toEqual(broad)
})
