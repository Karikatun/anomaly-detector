import { signalIds } from './anomaly-configuration'

const deckOffset = (seed: string) => [...seed].reduce(
  (total, character) => (total * 31 + character.charCodeAt(0)) % 1_000_003,
  0,
)

export type ContractDeckVersion = 'legacy-v1' | 'varied-v2'

export function createRoundContracts(
  round: number,
  playerCount: number,
  seed: string,
  version: ContractDeckVersion = 'varied-v2',
) {
  // Round one is the published onboarding deck. Later rounds rotate from the Tender
  // seed, so the complete five-round deck is reproducible without depending on play.
  const seedOffset = deckOffset(seed)
  const legacyOffset = (round - 1) * (playerCount + 1 + seedOffset)
  const signalStep = version === 'legacy-v1'
    ? playerCount + 1 + seedOffset
    : seedOffset % 2 === 0 ? 1 : signalIds.length - 1
  const resultStep = version === 'legacy-v1'
    ? playerCount + 1 + seedOffset
    : Math.floor(seedOffset / 2) % 2 === 0 ? 1 : 3
  const signalOffset = version === 'legacy-v1' ? legacyOffset : (round - 1) * signalStep
  const resultOffset = version === 'legacy-v1' ? legacyOffset : (round - 1) * resultStep
  const publicResults = ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'] as const
  return Array.from(
    { length: playerCount + 1 },
    (_, index) => ({
      contractId: `round-${round}-contract-${index + 1}`,
      requiredPublicResult: publicResults[(resultOffset + index) % publicResults.length],
      requiredSecondaryPublicResult: publicResults[(resultOffset + index + 1) % publicResults.length],
      targetSignal: signalIds[(signalOffset + index) % signalIds.length],
      kind: index === 0 ? 'scientific' as const : index === 1 ? 'complex' as const : 'light' as const,
      ratingReward: index === 0 ? 3 : index === 1 ? 4 : 2,
      targetRole: (resultOffset + index) % 2 === 0 ? 'source' as const : 'receiver' as const,
    }),
  )
}
