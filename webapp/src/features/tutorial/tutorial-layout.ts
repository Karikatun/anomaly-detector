import type { TutorialStep } from './scenario'

export function resolveTutorialPresentation({
  anchor,
  compactGuidance,
  compactHeader,
  spotlight,
  step,
}: {
  anchor: string
  compactGuidance?: boolean
  compactHeader: boolean
  spotlight?: string
  step: TutorialStep
}) {
  return {
    alignTargetStart: compactHeader
      && (step === 'round-1-power-intro' || step === 'round-2-power'),
    hideOverlay: false,
    positionTarget: compactHeader && step === 'help-menu'
      ? '[data-tutorial-board] > header'
      : anchor,
    spotlightTarget: (compactGuidance ?? compactHeader) && step === 'round-1-access-intro'
      ? anchor
      : spotlight ?? anchor,
  }
}
