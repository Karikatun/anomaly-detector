import { useEffect, useState } from 'react'

import { Typography } from '@/components/ui/typography'

type TenderTimerProps = {
  dueAt: string | null | undefined
}

export function TenderTimer({ dueAt }: TenderTimerProps) {
  const [remaining, setRemaining] = useState<number>(0)

  useEffect(() => {
    if (!dueAt) {
      setRemaining(0)
      return
    }

    const deadline = new Date(dueAt).getTime()

    const tick = () => {
      const diff = Math.max(0, deadline - Date.now())
      setRemaining(Math.ceil(diff / 1000))
    }

    tick()
    const interval = setInterval(tick, 250)

    return () => clearInterval(interval)
  }, [dueAt])

  if (!dueAt || remaining <= 0) return null

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const urgent = remaining <= 10

  return (
    <Typography
      variant="h4"
      className={`font-mono tabular-nums ${urgent ? 'text-red-400 animate-pulse' : 'text-primary'}`}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Typography>
  )
}
