import type { TutorialStep } from './scenario'

// Closing Interpretation can reveal its entry again. Both screens are the same step.
export const baseTutorialStepNumbers = {
  prologue: 0,
  'round-1-access': 1,
  'round-1-power': 2,
  'round-1-recon': 3,
  'round-1-lab-mode': 4,
  'round-1-lab-pair': 5,
  'research-results': 6,
  'research-results-open': 7,
  interpretation: 8,
  'interpretation-open': 8,
  'round-1-working-model': 9,
  'round-1-thesis': 10,
  'round-1-thesis-result': 11,
  'final-model': 12,
} as const satisfies Partial<Record<TutorialStep, number>>

export function isActiveBaseStep(step: TutorialStep): step is keyof typeof baseTutorialStepNumbers {
  return Object.hasOwn(baseTutorialStepNumbers, step)
}
