import { signalIds } from './anomaly-configuration'

const deckOffset = (seed: string) => [...seed].reduce(
  (total, character) => (total * 31 + character.charCodeAt(0)) % 1_000_003,
  0,
)

export function createRoundContracts(round: number, playerCount: number, seed: string) {
  // Round one is the published onboarding deck. Later rounds rotate from the Tender
  // seed, so the complete five-round deck is reproducible without depending on play.
  const offset = (round - 1) * (playerCount + 1 + deckOffset(seed))
  const publicResults = ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'] as const
  return Array.from(
    { length: playerCount + 1 },
    (_, index) => ({
      contractId: `round-${round}-contract-${index + 1}`,
      requiredPublicResult: publicResults[(offset + index) % publicResults.length],
      requiredSecondaryPublicResult: publicResults[(offset + index + 1) % publicResults.length],
      targetSignal: signalIds[(offset + index) % signalIds.length],
      kind: index === 0 ? 'scientific' as const : index === 1 ? 'complex' as const : 'light' as const,
      ratingReward: index === 0 ? 3 : index === 1 ? 4 : 2,
      targetRole: (offset + index) % 2 === 0 ? 'source' as const : 'receiver' as const,
    }),
  )
}
