import { getSynchronizedCountdownSeconds } from '@/platform/time/synchronized-countdown'

const ROOM_START_COUNTDOWN_SECONDS = 5

export function getRoomPollingIntervalMs(status: 'waiting' | 'starting' | 'started' | undefined) {
  if (status === 'started') return false
  return status === 'starting' ? 250 : 1_000
}

export function getRoomStartCountdownSeconds(
  startsAt: string | null | undefined,
  serverTime: string | null | undefined,
  elapsedMs: number,
) {
  if (!startsAt) return ROOM_START_COUNTDOWN_SECONDS

  return getSynchronizedCountdownSeconds(startsAt, serverTime, elapsedMs, {
    fallbackSeconds: ROOM_START_COUNTDOWN_SECONDS,
    maximumSeconds: ROOM_START_COUNTDOWN_SECONDS,
  })
}
