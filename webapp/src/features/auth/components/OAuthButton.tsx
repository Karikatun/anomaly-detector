import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

type OAuthButtonProps = {
  provider: 'yandex' | 'vk'
  label: string
}

export function OAuthButton({ provider, label }: OAuthButtonProps) {
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
        className="w-full"
        disabled={busy}
        onClick={() => void handleClick()}
      >
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
