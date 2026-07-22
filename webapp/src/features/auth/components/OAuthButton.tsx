import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

// OAuth must always use localhost in dev — Yandex/VK reject LAN IPs as redirect_uri.
const oauthApiBaseUrl = (import.meta.env?.VITE_OAUTH_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

type OAuthButtonProps = {
  provider: 'yandex' | 'vk'
  label: string
}

export function OAuthButton({ provider, label }: OAuthButtonProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${oauthApiBaseUrl}/api/auth/oauth/${provider}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webappOrigin: window.location.origin }),
      })
      if (!response.ok) {
        setBusy(false)
        setError(t('oauth.error.server'))
        return
      }
      const data = await response.json()
      window.location.href = data.authorizationUrl
    } catch {
      setBusy(false)
      setError(t('oauth.error.network'))
    }
  }, [busy, provider, t])

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
