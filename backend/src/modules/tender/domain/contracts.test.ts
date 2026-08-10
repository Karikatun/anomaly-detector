import { expect, test } from 'bun:test'

import { createRoundContracts } from './contracts'

test('changes both the target Signal and evidence conditions between consecutive rounds', () => {
  const seeds = [
    'ccb4c85e-e608-4a31-b150-89f095163959',
    'seed-1',
    'seed-2',
  ]

  for (const seed of seeds) {
    for (const playerCount of [2, 3, 4]) {
      const rounds = Array.from(
        { length: 5 },
        (_, index) => createRoundContracts(index + 1, playerCount, seed),
      )

      for (let roundIndex = 1; roundIndex < rounds.length; roundIndex += 1) {
        const previousRound = rounds[roundIndex - 1]
        const currentRound = rounds[roundIndex]

        for (let contractIndex = 0; contractIndex < currentRound.length; contractIndex += 1) {
          const previous = previousRound[contractIndex]
          const current = currentRound[contractIndex]

          expect(current.targetSignal).not.toBe(previous.targetSignal)
          expect([
            current.requiredPublicResult,
            current.requiredSecondaryPublicResult,
            current.targetRole,
          ]).not.toEqual([
            previous.requiredPublicResult,
            previous.requiredSecondaryPublicResult,
            previous.targetRole,
          ])
        }
      }
    }
  }
})

test('keeps the legacy rotation available for Tenders created before the varied deck', () => {
  const seed = 'ccb4c85e-e608-4a31-b150-89f095163959'

  expect(createRoundContracts(2, 2, seed, 'legacy-v1')).toEqual([
    expect.objectContaining({ targetSignal: 'aster', requiredPublicResult: 'reflection' }),
    expect.objectContaining({ targetSignal: 'boreal', requiredPublicResult: 'attenuation' }),
    expect.objectContaining({ targetSignal: 'cinder', requiredPublicResult: 'transmission_gain' }),
  ])
})
