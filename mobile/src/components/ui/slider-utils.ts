export function clampSliderValue(value: number, min: number, max: number, step = 1) {
  const safeStep = step > 0 ? step : 1;
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = Math.round((clamped - min) / safeStep) * safeStep + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(5));
}

export function normalizeSliderValues(values: number[], min: number, max: number, step = 1) {
  return values.map((value) => clampSliderValue(value, min, max, step)).sort((a, b) => a - b);
}
