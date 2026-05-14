export function normalizeOtpValue(value: string, maxLength: number) {
  return value.replace(/\s/g, '').slice(0, Math.max(0, maxLength));
}

export function getOtpSlots(value: string, maxLength: number) {
  const normalized = normalizeOtpValue(value, maxLength);
  return Array.from({ length: Math.max(0, maxLength) }, (_, index) => normalized[index] ?? '');
}
