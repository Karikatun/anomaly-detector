import type { TenderRuleset } from '@anomaly-detector/contracts'

const policies = {
  'tender-v1': {
    sharedFinalScientificModel: false,
    sharedModelAnalysis: false,
    versionedLaboratory: false,
  },
  'tender-v2': {
    sharedFinalScientificModel: true,
    sharedModelAnalysis: true,
    versionedLaboratory: true,
  },
} as const

export const tenderRulesetPolicy = (ruleset: TenderRuleset | undefined) =>
  policies[ruleset ?? 'tender-v1']
