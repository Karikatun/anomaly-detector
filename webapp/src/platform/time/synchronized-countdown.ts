import { useEffect, useMemo, useState } from 'react'

type CountdownOptions = {
  fallbackSeconds?: number
  maximumSeconds?: number
}

const monotonicNow = () => typeof performance === 'undefined' ? Date.now() : performance.now()

export function getSynchronizedCountdownSeconds(
  deadlineAt: string | null | undefined,
  serverTime: string | null | undefined,
  elapsedMs: number,
  options: CountdownOptions = {},
) {
  if (!deadlineAt || !serverTime) return options.fallbackSeconds ?? 0

  const estimatedServerTime = Date.parse(serverTime) + Math.max(0, elapsedMs)
  const remaining = Math.ceil(Math.max(0, Date.parse(deadlineAt) - estimatedServerTime) / 1_000)

  return options.maximumSeconds === undefined
    ? remaining
    : Math.min(options.maximumSeconds, remaining)
}

export function getSynchronizedCountdownUpdateDelay(
  deadlineAt: string | null | undefined,
  serverTime: string | null | undefined,
  elapsedMs: number,
  options: CountdownOptions = {},
) {
  if (!deadlineAt || !serverTime) return null

  const remainingMs = Math.max(
    0,
    Date.parse(deadlineAt) - Date.parse(serverTime) - Math.max(0, elapsedMs),
  )
  const visibleSeconds = getSynchronizedCountdownSeconds(
    deadlineAt,
    serverTime,
    elapsedMs,
    options,
  )
  if (remainingMs === 0 || visibleSeconds === 0) return null

  return Math.max(1, Math.ceil(remainingMs - (visibleSeconds - 1) * 1_000))
}

export function useSynchronizedCountdown(
  deadlineAt: string | null | undefined,
  serverTime: string | null | undefined,
  options: CountdownOptions = {},
) {
  const { fallbackSeconds, maximumSeconds } = options
  const anchor = useMemo(
    () => ({ localTime: monotonicNow(), serverTime }),
    [serverTime],
  )
  const [localTime, setLocalTime] = useState(monotonicNow)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const updateLocalTime = () => {
      const nextLocalTime = monotonicNow()
      setLocalTime((previousLocalTime) => {
        const previousSeconds = getSynchronizedCountdownSeconds(
          deadlineAt,
          anchor.serverTime,
          Math.max(0, previousLocalTime - anchor.localTime),
          { fallbackSeconds, maximumSeconds },
        )
        const nextSeconds = getSynchronizedCountdownSeconds(
          deadlineAt,
          anchor.serverTime,
          Math.max(0, nextLocalTime - anchor.localTime),
          { fallbackSeconds, maximumSeconds },
        )
        return previousSeconds === nextSeconds ? previousLocalTime : nextLocalTime
      })

      const delay = getSynchronizedCountdownUpdateDelay(
        deadlineAt,
        anchor.serverTime,
        Math.max(0, nextLocalTime - anchor.localTime),
        { fallbackSeconds, maximumSeconds },
      )
      if (delay !== null) timeout = setTimeout(updateLocalTime, delay)
    }
    updateLocalTime()

    return () => {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }, [anchor, deadlineAt, fallbackSeconds, maximumSeconds])

  return getSynchronizedCountdownSeconds(
    deadlineAt,
    anchor.serverTime,
    Math.max(0, localTime - anchor.localTime),
    { fallbackSeconds, maximumSeconds },
  )
}
