import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import styles from './AuthForm.module.css'
import { LoginForm } from './LoginForm'

export function AuthForm({ footerRulesAction }: { footerRulesAction?: ReactNode }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'choice' | 'login' | 'register'>('choice')

  return (
    <section className={styles.screen} aria-label={t('auth.title')}>
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.panel}>
        <header className={styles.brand}>
          <Typography as="span" className={styles.wordmark}>ANOMALY</Typography>
          <Typography as="span" className={styles.detector}>DETECTOR</Typography>
        </header>

        {mode === 'choice' ? (
          <div className={`${styles.content} ${styles.choiceContent}`}>
            <Button
              type="button"
              size="lg"
              className={styles.choiceButton}
              onClick={() => setMode('login')}
            >
              {t('auth.login')}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className={styles.choiceButton}
              onClick={() => setMode('register')}
            >
              {t('auth.register')}
            </Button>
          </div>
        ) : (
          <div className={styles.content}>
            <Button
              type="button"
              variant="ghost"
              className={styles.backButton}
              onClick={() => setMode('choice')}
            >
              Назад
            </Button>
            <LoginForm key={mode} mode={mode} />
          </div>
        )}

        <footer className={styles.footer}>
          {footerRulesAction ?? <Typography as="span">Правила игры</Typography>}
          <Link className={styles.legalLink} to="/terms">Пользовательское соглашение</Link>
        </footer>
      </div>
    </section>
  )
}
