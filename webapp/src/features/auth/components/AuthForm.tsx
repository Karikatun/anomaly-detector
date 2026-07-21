import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/platform/i18n'
import { OAuthButton } from './OAuthButton'

export function AuthForm() {
  const { t } = useI18n()

  return (
    <Card className="w-full" aria-label={t('auth.title')}>
      <CardHeader>
        <CardTitle className="tracking-wide uppercase">{t('auth.title')}</CardTitle>
        <CardDescription>{t('auth.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <OAuthButton provider="yandex" label={t('oauth.yandex')} />
        <OAuthButton provider="vk" label={t('oauth.vk')} />
      </CardContent>
    </Card>
  )
}
