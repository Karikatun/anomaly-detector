import { translate } from '../../platform/i18n'
import { Typography } from '@/components/ui/typography'

type TenderTimerProps = {
  remainingSeconds: number | null
}

export function TenderTimer({ remainingSeconds }: TenderTimerProps) {
  if (remainingSeconds === null) return null

  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  const urgent = remainingSeconds <= 10

  return (
    <Typography
      aria-label={translate('tender.tenderTimer.copy.001')}
      role="timer"
      variant="timer"
      className={urgent
        ? 'text-red-400 animate-pulse [animation-duration:var(--motion-loop)] motion-reduce:animate-none'
        : 'text-primary'}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Typography>
  )
}
