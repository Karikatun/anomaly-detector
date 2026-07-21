import { useCallback, useState } from 'react'

import { oauthStartRequestSchema, oauthStartResponseSchema } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/platform/i18n'

const defaultApiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

type OAuthButtonProps = {
  provider: 'yandex' | 'vk'
  label: string
}

export function OAuthButton({ provider, label }: OAuthButtonProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  const handleClick = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const redirectUri = `${defaultApiBaseUrl}/api/auth/oauth/${provider}/callback`
      const payload = oauthStartRequestSchema.parse({ redirectUri })
      const response = await fetch(`${defaultApiBaseUrl}/api/auth/oauth/${provider}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        setBusy(false)
        return
      }
      const data = oauthStartResponseSchema.parse(await response.json())
      window.location.href = data.authorizationUrl
    } catch {
      setBusy(false)
    }
  }, [busy, provider])

  return (
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
  )
}