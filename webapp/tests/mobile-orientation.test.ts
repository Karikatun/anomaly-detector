import { describe, expect, test } from 'bun:test'
import { isCompactTouchDisplay, isLandscapeScreen, type MobileDisplay } from '../src/platform/display/mobile-orientation'

const phone: MobileDisplay = {
  screenWidth: 390, screenHeight: 844, coarsePointer: true, noHover: true,
  orientationType: 'portrait-primary',
}

describe('mobile physical display policy', () => {
  test('identifies the same compact touch phone after rotation', () => {
    expect(isCompactTouchDisplay(phone)).toBe(true)
    expect(isCompactTouchDisplay({ ...phone, screenWidth: 844, screenHeight: 390 })).toBe(true)
  })

  test.each([
    { screenWidth: 1440, screenHeight: 900 },
    { screenWidth: 1024, screenHeight: 768 },
    { screenWidth: 768, screenHeight: 1024 },
    { coarsePointer: false },
    { noHover: false },
    { screenWidth: 0 },
  ])('keeps desktop, tablet and pointer displays unblocked: %j', (input) => {
    expect(isCompactTouchDisplay({ ...phone, ...input })).toBe(false)
  })

  test.each(['landscape-primary', 'landscape-secondary'])('blocks physical %s', (orientationType) => {
    expect(isLandscapeScreen({ ...phone, orientationType })).toBe(true)
  })

  test.each(['portrait-primary', 'portrait-secondary'])('keeps physical %s usable', (orientationType) => {
    expect(isLandscapeScreen({ ...phone, orientationType, legacyOrientation: 90 })).toBe(false)
  })

  test('a portrait keyboard viewport change cannot change screen orientation', () => {
    const displayWithKeyboard = { ...phone, viewportWidth: 390, viewportHeight: 260 }
    expect(isLandscapeScreen(displayWithKeyboard)).toBe(false)
    expect(isCompactTouchDisplay(displayWithKeyboard)).toBe(true)
  })

  test.each([-90, 90, 270])('supports an available legacy physical angle %s', (legacyOrientation) => {
    expect(isLandscapeScreen({ ...phone, orientationType: undefined, legacyOrientation })).toBe(true)
  })

  test.each([undefined, 0, 180, 360])('does not invent landscape from an unavailable or portrait legacy angle %s', (legacyOrientation) => {
    expect(isLandscapeScreen({ ...phone, orientationType: undefined, legacyOrientation })).toBe(false)
  })
})
