import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'

import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { isMetrikaSafePath, metrika, metrikaConfigured } from './metrika'

const consentStorageKey = 'anomaly-detector:metrika-consent'
type ConsentChoice = 'allowed' | 'necessary' | 'undecided'

export function MetrikaConsent({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [choice, setChoice] = useState<ConsentChoice>(() => readConsentChoice())

  useEffect(() => {
    if (!isMetrikaSafePath(pathname)) return
    if (choice === 'allowed') metrika.enable()
  }, [choice, pathname])

  if (
    !metrikaConfigured
    || !isMetrikaSafePath(pathname)
    || choice !== 'undecided'
    || (pathname === '/learn') !== inline
  ) return null

  const choose = (nextChoice: Exclude<ConsentChoice, 'undecided'>) => {
    setChoice(nextChoice)
    try {
      window.localStorage.setItem(consentStorageKey, nextChoice)
    } catch {
      // A blocked storage still leaves the choice effective for this page.
    }
    if (nextChoice === 'allowed') metrika.enable()
  }

  return (
    <aside
      className={inline
        ? 'grid gap-3 rounded-lg border border-cyan-300/20 bg-cyan-950/10 p-3 text-slate-300'
        : 'fixed bottom-4 left-4 z-[var(--layer-sticky)] w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-cyan-300/20 bg-slate-950/95 p-4 text-slate-300 shadow-[var(--shadow-overlay)] backdrop-blur sm:bottom-5 sm:left-5'}
      data-metrika-consent
      aria-labelledby="metrika-consent-title"
    >
      <div className="grid gap-3">
        <div className="min-w-0">
          <Typography asChild variant="h6" tone="default">
            <h2 id="metrika-consent-title" className="text-slate-100">{t('metrika.consent.title')}</h2>
          </Typography>
          <Typography variant="bodySm" tone="muted" className="mt-1">
            {t('metrika.consent.description')}
            {' '}
            <Link className="text-cyan-200 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" to="/privacy">
              {t('metrika.consent.details')}
            </Link>
          </Typography>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-md bg-cyan-300 px-4 text-slate-950 hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            data-metrika-action="allow"
            onClick={() => choose('allowed')}
          >
            <Typography asChild variant="controlWrap" tone="inverse"><span>{t('metrika.consent.allow')}</span></Typography>
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md border border-slate-600 px-4 text-slate-200 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            data-metrika-action="necessary"
            onClick={() => choose('necessary')}
          >
            <Typography asChild variant="controlWrap"><span>{t('metrika.consent.necessary')}</span></Typography>
          </button>
        </div>
      </div>
    </aside>
  )
}

export function MetrikaPrivacySettings() {
  const { t } = useI18n()
  const [choice] = useState<ConsentChoice>(() => readConsentChoice())

  if (!metrikaConfigured) return null

  const updateChoice = (nextChoice: Exclude<ConsentChoice, 'undecided'>) => {
    try {
      window.localStorage.setItem(consentStorageKey, nextChoice)
    } catch {
      // Reload still clears an active counter from this page.
    }
    window.location.reload()
  }

  return (
    <section className="grid gap-3 rounded-lg border border-cyan-300/20 bg-cyan-950/10 p-4" aria-labelledby="metrika-settings-title">
      <div>
        <Typography asChild variant="h3"><h2 id="metrika-settings-title" className="!m-0">{t('metrika.settings.title')}</h2></Typography>
        <Typography variant="bodySm" tone="muted" className="mt-1">
          {choice === 'allowed' ? t('metrika.settings.allowed') : t('metrika.settings.disabled')}
        </Typography>
      </div>
      <button
        type="button"
        className="min-h-11 w-fit rounded-md border border-slate-600 px-4 text-slate-200 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
        data-metrika-action={choice === 'allowed' ? 'revoke' : 'allow'}
        onClick={() => updateChoice(choice === 'allowed' ? 'necessary' : 'allowed')}
      >
        <Typography asChild variant="controlWrap">
          <span>{choice === 'allowed' ? t('metrika.consent.revoke') : t('metrika.consent.allow')}</span>
        </Typography>
      </button>
    </section>
  )
}

function readConsentChoice(): ConsentChoice {
  if (typeof window === 'undefined') return 'undecided'
  try {
    const stored = window.localStorage.getItem(consentStorageKey)
    return stored === 'allowed' || stored === 'necessary' ? stored : 'undecided'
  } catch {
    return 'undecided'
  }
}
