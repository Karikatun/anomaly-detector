import { useEffect, useMemo, useState } from 'react'

type CountdownOptions = {
  fallbackSeconds?: number
  maximumSeconds?: number
  tickMs?: number
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

export function useSynchronizedCountdown(
  deadlineAt: string | null | undefined,
  serverTime: string | null | undefined,
  options: CountdownOptions = {},
) {
  const { fallbackSeconds, maximumSeconds, tickMs = 250 } = options
  const anchor = useMemo(
    () => ({ localTime: monotonicNow(), serverTime }),
    [serverTime],
  )
  const [localTime, setLocalTime] = useState(monotonicNow)

  useEffect(() => {
    const updateLocalTime = () => setLocalTime(monotonicNow())
    updateLocalTime()
    const interval = setInterval(updateLocalTime, tickMs)

    return () => clearInterval(interval)
  }, [serverTime, tickMs])

  return getSynchronizedCountdownSeconds(
    deadlineAt,
    anchor.serverTime,
    Math.max(0, localTime - anchor.localTime),
    { fallbackSeconds, maximumSeconds },
  )
}
