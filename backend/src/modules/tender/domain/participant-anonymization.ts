export function anonymizeParticipantInValue<T>(
  value: T,
  playerId: string,
  anonymousPlayerId: string,
): T {
  if (value === playerId) return anonymousPlayerId as T
  if (value instanceof Date || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) =>
      anonymizeParticipantInValue(item, playerId, anonymousPlayerId)) as T
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === playerId ? anonymousPlayerId : key,
      key === 'fingerprint' && typeof item === 'string'
        ? anonymizeParticipantInJsonString(item, playerId, anonymousPlayerId)
        : anonymizeParticipantInValue(item, playerId, anonymousPlayerId),
    ]),
  ) as T
}

export function anonymizeParticipantInJsonString(
  value: string,
  playerId: string,
  anonymousPlayerId: string,
) {
  try {
    return JSON.stringify(
      anonymizeParticipantInValue(JSON.parse(value), playerId, anonymousPlayerId),
    )
  } catch {
    return value
  }
}
