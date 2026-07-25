const ROOM_START_COUNTDOWN_SECONDS = 5

export function getRoomStartCountdownSeconds(startsAt: string | null | undefined, now: number) {
  if (!startsAt) return ROOM_START_COUNTDOWN_SECONDS

  const secondsLeft = Math.ceil((Date.parse(startsAt) - now) / 1_000)
  return Math.min(ROOM_START_COUNTDOWN_SECONDS, Math.max(0, secondsLeft))
}
