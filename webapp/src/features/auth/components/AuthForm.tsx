import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { LoginForm } from './LoginForm'
import { OAuthButton } from './OAuthButton'
import { emptyDraft, type AuthDraft, type AuthMode } from './form-model'
import { RegisterForm } from './RegisterForm'

export function AuthForm() {
  const { t } = useI18n()
  const [mode, setMode] = useState<AuthMode>('register')
  const [draft, setDraft] = useState<AuthDraft>(emptyDraft)

  function updateDraft(nextDraft: Partial<AuthDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...nextDraft }))
  }

  return (
    <Card className="w-full" aria-label={t('auth.title')}>
      <CardHeader>
        <CardTitle className="tracking-wide uppercase">{t('auth.title')}</CardTitle>
        <CardDescription>{t('auth.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(nextMode) => {
            if (nextMode === 'login' || nextMode === 'register') setMode(nextMode)
          }}
          className="mb-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="register">{t('auth.tab.register')}</TabsTrigger>
            <TabsTrigger value="login">{t('auth.tab.login')}</TabsTrigger>
          </TabsList>
          <TabsContent value="register" forceMount hidden={mode !== 'register'} className="mt-6">
            {mode === 'register' && <RegisterForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
          <TabsContent value="login" forceMount hidden={mode !== 'login'} className="mt-6">
            {mode === 'login' && <LoginForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
        </Tabs>

        <Separator className="mb-3" />
        <Typography variant="control" tone="muted" className="mb-3 text-center">
          {t('auth.oauth.or')}
        </Typography>
        <div className="grid gap-2">
          <OAuthButton provider="yandex" label={t('oauth.yandex')} />
          <OAuthButton provider="vk" label={t('oauth.vk')} />
        </div>
      </CardContent>
    </Card>
  )
}