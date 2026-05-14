export const MIN_TOUCH_TARGET = 44;

export function createMinTouchTargetStyle(axis: 'both' | 'height' | 'width' = 'both') {
  return {
    ...(axis === 'both' || axis === 'height' ? { minHeight: MIN_TOUCH_TARGET } : {}),
    ...(axis === 'both' || axis === 'width' ? { minWidth: MIN_TOUCH_TARGET } : {}),
  };
}
