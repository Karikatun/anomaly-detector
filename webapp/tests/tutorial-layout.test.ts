import { describe, expect, test } from 'bun:test'

import { resolveTutorialPresentation } from '../src/features/tutorial/tutorial-layout'

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
