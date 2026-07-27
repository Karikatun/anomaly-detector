import { type ReactNode, useCallback, useState } from 'react'
import type { OAuthProviderId, OAuthStartRequest } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { useAuth } from '../use-auth'

type OAuthButtonProps = {
  provider: OAuthProviderId
  label: string
  className?: string
  icon?: ReactNode
  registration?: OAuthStartRequest['registration']
  requireRegistrationConsent?: boolean
  onConsentRequired?: () => void
}

export function OAuthButton({
  provider,
  label,
  className,
  icon,
  registration,
  requireRegistrationConsent = false,
  onConsentRequired,
}: OAuthButtonProps) {
  const { t } = useI18n()
  const { startOAuth } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    if (busy) return
    if (requireRegistrationConsent && !registration) {
      onConsentRequired?.()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await startOAuth(provider, registration)
    } catch {
      setBusy(false)
      setError(t('oauth.error.server'))
    }
  }, [busy, onConsentRequired, provider, registration, requireRegistrationConsent, startOAuth, t])

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn('w-full', className)}
        disabled={busy}
        onClick={() => void handleClick()}
      >
        {icon}
        {busy ? t('oauth.redirecting') : label}
      </Button>
      {error && (
        <Typography variant="bodySm" tone="destructive" className="text-center">
          {error}
        </Typography>
      )}
    </div>
  )
}
