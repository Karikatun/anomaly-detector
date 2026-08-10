import { expect, test } from 'bun:test'

import { createContractPlanning, isContractEvidenceSelectionEligible } from './contract-eligibility'

const contract = {
  contractId: 'light-1',
  kind: 'light' as const,
  ratingReward: 4,
  requiredPublicResult: 'reflection' as const,
  targetRole: 'source' as const,
  targetSignal: 'aster' as const,
}

const createState = () => ({
  corporateTrustByPlayer: { player: 0 },
  publicScientificJournal: [{
    playerId: 'player',
    protocol: 'impulse' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'test-1',
  }],
  researchCertificationsByPlayer: {},
  round: 1,
  usedContractEvidenceTestIds: [] as string[],
})

test('uses one matching unused journal entry for a light contract', () => {
  const state = createState()

  expect(createContractPlanning(state, 'player', contract)).toMatchObject({
    eligible: true,
    missingConditions: [],
    suitableEvidenceSelections: [['test-1']],
  })
  expect(isContractEvidenceSelectionEligible(state, 'player', contract, ['test-1'])).toBe(true)
})

test('explains when the only suitable evidence was already consumed', () => {
  const state = createState()
  state.usedContractEvidenceTestIds = ['test-1']

  expect(createContractPlanning(state, 'player', contract)).toMatchObject({
    eligible: false,
    missingConditions: ['evidence_used'],
  })
})
