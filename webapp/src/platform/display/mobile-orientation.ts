export type MobileDisplay = {
  screenWidth: number
  screenHeight: number
  coarsePointer: boolean
  noHover: boolean
  orientationType?: string
  legacyOrientation?: number
}

export function isCompactTouchDisplay(display: MobileDisplay) {
  return display.screenWidth > 0 && display.screenHeight > 0
    && Math.min(display.screenWidth, display.screenHeight) < 768
    && display.coarsePointer && display.noHover
}

export function isLandscapeScreen(display: MobileDisplay) {
  if (display.orientationType?.startsWith('landscape-')) return true
  if (display.orientationType?.startsWith('portrait-')) return false
  // Older phone browsers expose the physical angle instead of ScreenOrientation.
  // Never infer it from the viewport: a portrait keyboard can make that landscape.
  return typeof display.legacyOrientation === 'number'
    && Math.abs(display.legacyOrientation) % 180 === 90
}

export function readMobileDisplay(): MobileDisplay {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    noHover: window.matchMedia('(hover: none)').matches,
    orientationType: window.screen.orientation?.type,
    legacyOrientation: window.orientation,
  }
}

export function subscribeScreenOrientation(listener: () => void) {
  const orientation = window.screen.orientation
  orientation?.addEventListener('change', listener)
  window.addEventListener('orientationchange', listener)
  return () => {
    orientation?.removeEventListener('change', listener)
    window.removeEventListener('orientationchange', listener)
  }
}
