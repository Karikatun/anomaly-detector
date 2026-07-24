import { useEffect, useState } from 'react'

import { Typography } from '@/components/ui/typography'

type TenderTimerProps = {
  dueAt: string | null | undefined
}

export function TenderTimer({ dueAt }: TenderTimerProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250)

    return () => clearInterval(interval)
  }, [])

  const remaining = dueAt
    ? Math.ceil(Math.max(0, new Date(dueAt).getTime() - now) / 1000)
    : 0

  if (!dueAt || remaining <= 0) return null

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const urgent = remaining <= 10

  return (
    <Typography
      variant="timer"
      className={urgent ? 'text-red-400 animate-pulse' : 'text-primary'}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Typography>
  )
}
