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


export type TutorialRect = { top: number; bottom: number; left: number; right: number }

// Only layers sharing the target's column reduce its usable vertical interval.
export function tutorialSafeVerticalBounds({ viewport, target, blockers }: {
  viewport: TutorialRect
  target: TutorialRect
  blockers: TutorialRect[]
}) {
  let top = viewport.top + 12
  let bottom = viewport.bottom - 12
  for (const blocker of blockers) {
    if (blocker.right <= target.left || blocker.left >= target.right
      || blocker.bottom <= viewport.top || blocker.top >= viewport.bottom) continue
    if (blocker.top <= viewport.top + 24) top = Math.max(top, blocker.bottom + 12)
    else bottom = Math.min(bottom, blocker.top - 12)
  }
  return { top, bottom }
}

export function tutorialScrollDelta(target: { top: number; bottom: number }, bounds: { top: number; bottom: number }) {
  if (target.top < bounds.top) return target.top - bounds.top
  if (target.bottom > bounds.bottom) return target.bottom - bounds.bottom
  return 0
}
