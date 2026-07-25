import { type ReactNode, useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { useAuth } from '../use-auth'

type OAuthButtonProps = {
  provider: 'yandex' | 'vk'
  label: string
  className?: string
  icon?: ReactNode
}

export function OAuthButton({ provider, label, className, icon }: OAuthButtonProps) {
  const { t } = useI18n()
  const { startOAuth } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await startOAuth(provider)
    } catch {
      setBusy(false)
      setError(t('oauth.error.server'))
    }
  }, [busy, provider, startOAuth, t])

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
