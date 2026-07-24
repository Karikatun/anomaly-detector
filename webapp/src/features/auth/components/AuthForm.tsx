import type { ReactNode } from 'react'

import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import styles from './AuthForm.module.css'
import { LoginForm } from './LoginForm'
import { OAuthButton } from './OAuthButton'

export function AuthForm({ footerRulesAction }: { footerRulesAction?: ReactNode }) {
  const { t } = useI18n()

  return (
    <section className={styles.screen} aria-label={t('auth.title')}>
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.panel}>
        <header className={styles.brand}>
          <Typography as="span" className={styles.wordmark}>ANOMALY</Typography>
          <Typography as="span" className={styles.detector}>DETECTOR</Typography>
        </header>

        <div className={styles.content}>
          <OAuthButton provider="yandex" label={t('oauth.yandex')} className={styles.yandexButton} />
          <div className={styles.separator}>ИЛИ</div>
          <LoginForm />
        </div>

        <footer className={styles.footer}>
          {footerRulesAction ?? <Typography as="span">Правила игры</Typography>}
          <Typography as="span">Пользовательское соглашение</Typography>
        </footer>
      </div>
    </section>
  )
}
