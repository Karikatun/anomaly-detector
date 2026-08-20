import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { personalDataConsentVersion, termsVersion } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/platform/i18n'
import { useAuth } from '../use-auth'
import { capturePostAuthContinuation } from '../post-auth-continuation'
import styles from './AuthForm.module.css'
import { LoginForm } from './LoginForm'

export function AuthForm({ footerRulesAction }: { footerRulesAction?: ReactNode }) {
  const { t } = useI18n()
  const auth = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(() => {
    if (typeof window === 'undefined') return 'login'
    return capturePostAuthContinuation(sessionStorage, new URL(window.location.href)) === 'tutorial'
      ? 'register'
      : 'login'
  })
  const [oauthConsentOpen, setOauthConsentOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URL(window.location.href).searchParams.get('auth_error') === 'oauth_registration_consent_required'
  })
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('auth_error') === 'oauth_registration_consent_required') {
      url.searchParams.delete('auth_error')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthPrivacyConsent, setOauthPrivacyConsent] = useState(false)
  const [oauthTermsAccepted, setOauthTermsAccepted] = useState(false)

  return (
    <section className={styles.screen} aria-labelledby="auth-screen-title">
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.panel}>
        <header className={styles.brand}>
          <Typography as="h1" id="auth-screen-title" variant="srOnly">
            {t(mode === 'register' ? 'auth.register' : 'auth.title')}
          </Typography>
          <Typography as="span" className={styles.wordmark}>{t('app.brand.primary')}</Typography>
          <Typography as="span" className={styles.detector}>{t('app.brand.secondary')}</Typography>
          <Typography className={styles.tagline}>{t('auth.tagline')}</Typography>
        </header>

        <div className={styles.content}>
          <div className={styles.modeTabs} role="tablist" aria-label={t('auth.mode.label')}>
            <Button
              id="auth-login-tab"
              type="button"
              role="tab"
              aria-controls="auth-credentials-panel"
              aria-selected={mode === 'login'}
              variant={mode === 'login' ? 'default' : 'ghost'}
              className={styles.modeTab}
              onClick={() => setMode('login')}
            >
              {t('auth.title')}
            </Button>
            <Button
              id="auth-register-tab"
              type="button"
              role="tab"
              aria-controls="auth-credentials-panel"
              aria-selected={mode === 'register'}
              variant={mode === 'register' ? 'default' : 'ghost'}
              className={styles.modeTab}
              onClick={() => setMode('register')}
            >
              {t('auth.register')}
            </Button>
          </div>
          <div
            id="auth-credentials-panel"
            role="tabpanel"
            aria-labelledby={mode === 'register' ? 'auth-register-tab' : 'auth-login-tab'}
          >
            <LoginForm key={mode} mode={mode} />
          </div>
        </div>

        <footer className={styles.footer}>
          {footerRulesAction ?? <Typography as="span">{t('auth.rules')}</Typography>}
          <Link className={styles.legalLink} to="/terms">{t('auth.terms.link')}</Link>
        </footer>
      </div>
      <Dialog open={oauthConsentOpen} onOpenChange={setOauthConsentOpen}>
        <DialogContent className={styles.oauthConsentDialog}>
          <DialogHeader>
            <DialogTitle>{t('auth.oauthConsent.title')}</DialogTitle>
            <DialogDescription>
              {t('auth.oauthConsent.description')}
            </DialogDescription>
          </DialogHeader>
          <div className={styles.consents}>
            <div className={styles.consent}>
              <Checkbox
                id="oauth-privacy-consent"
                checked={oauthPrivacyConsent}
                onCheckedChange={(checked) => setOauthPrivacyConsent(checked === true)}
              />
              <Label htmlFor="oauth-privacy-consent">
                {t('auth.consent.prefix')}{' '}
                <Link className={styles.inlineLegalLink} to="/personal-data-consent" target="_blank">
                  {t('auth.consent.link')}
                </Link>
              </Label>
            </div>
            <div className={styles.consent}>
              <Checkbox
                id="oauth-terms-acceptance"
                checked={oauthTermsAccepted}
                onCheckedChange={(checked) => setOauthTermsAccepted(checked === true)}
              />
              <Label htmlFor="oauth-terms-acceptance">
                {t('auth.terms.acceptPrefix')}{' '}
                <Link className={styles.inlineLegalLink} to="/terms" target="_blank">
                  {t('auth.terms.link')}
                </Link>
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={oauthBusy || !oauthPrivacyConsent || !oauthTermsAccepted}
              onClick={() => {
                setOauthBusy(true)
                void auth.startOAuth('yandex', {
                  privacyConsent: true,
                  privacyConsentVersion: personalDataConsentVersion,
                  termsAccepted: true,
                  termsVersion,
                }).catch(() => setOauthBusy(false))
              }}
            >
              {oauthBusy ? t('auth.oauthConsent.pending') : t('auth.oauthConsent.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
