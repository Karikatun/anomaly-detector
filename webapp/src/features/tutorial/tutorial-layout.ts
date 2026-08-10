import type { TutorialStep } from './scenario'

export function resolveTutorialPresentation({
  anchor,
  compactHeader,
  spotlight,
  step,
}: {
  anchor: string
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
    spotlightTarget: spotlight ?? anchor,
  }
}
