import { Typography } from '@/components/ui/typography'
import { useSynchronizedCountdown } from '@/platform/time/synchronized-countdown'

type TenderTimerProps = {
  dueAt: string | null | undefined
  serverTime: string
}

export function TenderTimer({ dueAt, serverTime }: TenderTimerProps) {
  const remaining = useSynchronizedCountdown(dueAt, serverTime)

  if (!dueAt) return null

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const urgent = remaining <= 10

  return (
    <Typography
      aria-label="До конца фазы"
      role="timer"
      variant="timer"
      className={urgent ? 'text-red-400 animate-pulse' : 'text-primary'}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Typography>
  )
}
