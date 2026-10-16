import { describe, expect, test } from 'bun:test'

import { resolveTutorialPresentation, tutorialSafeVerticalBounds, tutorialScrollDelta } from '../src/features/tutorial/tutorial-layout'

describe('tutorial responsive presentation', () => {
  test.each([
    ['round-1-power', '[data-tutorial-power-options]'],
    ['round-1-lab-pair', '[data-tutorial-lab-pair]'],
    ['round-1-thesis', '[data-tutorial-thesis]'],
    ['round-2-power', '[data-tutorial-power-options]'],
    ['round-2-recon', '[data-tutorial-recon-options]'],
    ['round-2-lab', '[data-tutorial-lab-options]'],
    ['round-2-thesis', '[data-tutorial-thesis]'],
  ] as const)('keeps the %s spotlight visible and interactive on mobile', (step, spotlight) => {
    expect(resolveTutorialPresentation({
      anchor: '[data-tutorial-anchor]',
      compactHeader: true,
      spotlight,
      step,
    })).toMatchObject({
      hideOverlay: false,
      spotlightTarget: spotlight,
    })
  })

  test('positions the mobile Help step from the whole header without changing its button spotlight', () => {
    expect(resolveTutorialPresentation({
      anchor: '[data-tutorial-help]',
      compactHeader: true,
      step: 'help-menu',
    })).toMatchObject({
      positionTarget: '[data-tutorial-board] > header',
      spotlightTarget: '[data-tutorial-help]',
    })
  })

  test.each([
    'round-1-power-intro',
    'round-2-power',
  ] as const)('aligns the start of the tall %s spotlight on mobile', (step) => {
    expect(resolveTutorialPresentation({
      anchor: '[data-tutorial-anchor]',
      compactHeader: true,
      spotlight: '[data-tutorial-spotlight]',
      step,
    })).toMatchObject({
      alignTargetStart: true,
    })
  })
})


describe('tutorial target visibility', () => {
  test('reserves the actual pinned command before the lower coach', () => {
    expect(tutorialSafeVerticalBounds({
      viewport: { top: 20, bottom: 864, left: 0, right: 390 },
      target: { top: 795, bottom: 975, left: 12, right: 190 },
      blockers: [
        { top: 20, bottom: 157, left: 0, right: 390 },
        { top: 675, bottom: 852, left: 12, right: 378 },
        { top: 541, bottom: 663, left: 12, right: 378 },
      ],
    })).toEqual({ top: 169, bottom: 529 })
  })
  test('does not reserve a coach in another desktop column', () => {
    expect(tutorialSafeVerticalBounds({
      viewport: { top: 0, bottom: 900, left: 0, right: 1440 },
      target: { top: 400, bottom: 450, left: 24, right: 700 },
      blockers: [{ top: 600, bottom: 880, left: 1040, right: 1420 }],
    })).toEqual({ top: 12, bottom: 888 })
  })
  test('moves only the distance needed and leaves a visible target alone', () => {
    expect(tutorialScrollDelta({ top: 795, bottom: 975 }, { top: 169, bottom: 529 })).toBe(446)
    expect(tutorialScrollDelta({ top: 120, bottom: 180 }, { top: 169, bottom: 529 })).toBe(-49)
    expect(tutorialScrollDelta({ top: 200, bottom: 380 }, { top: 169, bottom: 529 })).toBe(0)
  })
})
