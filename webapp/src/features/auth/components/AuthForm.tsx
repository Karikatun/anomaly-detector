import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/platform/i18n'
import { LoginForm } from './LoginForm'
import { OAuthButton } from './OAuthButton'

export function AuthForm() {
  const { t } = useI18n()

  return (
    <Card className="w-full" aria-label={t('auth.title')}>
      <CardHeader>
        <CardTitle className="tracking-wide uppercase">{t('auth.title')}</CardTitle>
        <CardDescription>{t('auth.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <LoginForm />
        <Separator />
        <div className="grid gap-3">
          <OAuthButton provider="yandex" label={t('oauth.yandex')} />
          <OAuthButton provider="vk" label={t('oauth.vk')} />
        </div>
      </CardContent>
    </Card>
  )
}
