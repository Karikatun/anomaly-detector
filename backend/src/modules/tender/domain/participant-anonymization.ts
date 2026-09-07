export function anonymizeParticipantInValue<T>(
  value: T,
  playerId: string,
  anonymousPlayerId: string,
): T {
  if (typeof value === 'string') {
    return anonymizeParticipantInString(value, playerId, anonymousPlayerId) as T
  }
  if (value instanceof Date || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) =>
      anonymizeParticipantInValue(item, playerId, anonymousPlayerId)) as T
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      anonymizeParticipantInString(key, playerId, anonymousPlayerId),
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
    return anonymizeParticipantInString(value, playerId, anonymousPlayerId)
  }
}

export function embeddedParticipantPseudonym(
  playerId: string,
  anonymousPlayerId: string,
) {
  return anonymousPlayerId.length >= playerId.length
    ? anonymousPlayerId.slice(0, playerId.length)
    : anonymousPlayerId.padEnd(playerId.length, '_')
}

function anonymizeParticipantInString(
  value: string,
  playerId: string,
  anonymousPlayerId: string,
) {
  if (value === playerId) return anonymousPlayerId
  if (!value.includes(playerId)) return value
  return value.replaceAll(
    playerId,
    embeddedParticipantPseudonym(playerId, anonymousPlayerId),
  )
}
