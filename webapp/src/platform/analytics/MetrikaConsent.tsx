import { useEffect, useState } from 'react'

import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { isMetrikaSafePath, metrika, metrikaConfigured } from './metrika'

const consentStorageKey = 'anomaly-detector:metrika-consent'
type ConsentChoice = 'allowed' | 'necessary' | 'undecided'

export function MetrikaConsent() {
  const { t } = useI18n()
  const [choice, setChoice] = useState<ConsentChoice>(() => readConsentChoice())

  useEffect(() => {
    if (!isMetrikaSafePath(window.location.pathname)) return
    if (choice === 'allowed') metrika.enable()
  }, [choice])

  if (!metrikaConfigured || typeof window === 'undefined' || !isMetrikaSafePath(window.location.pathname)) return null

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
      className="relative z-[110] border-t border-cyan-300/20 bg-slate-950/95 px-5 py-4 text-slate-300"
      data-metrika-consent
      aria-labelledby="metrika-consent-title"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <Typography asChild variant="h6" tone="default">
            <h2 id="metrika-consent-title" className="text-slate-100">{t('metrika.consent.title')}</h2>
          </Typography>
          <Typography variant="bodySm" tone="muted" className="mt-1 max-w-3xl">
            {t('metrika.consent.description')}
          </Typography>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {choice !== 'allowed' && (
            <button
              type="button"
              className="min-h-11 rounded-md bg-cyan-300 px-4 text-slate-950 hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
              data-metrika-action="allow"
              onClick={() => choose('allowed')}
            >
              <Typography asChild variant="controlWrap" tone="inverse"><span>{t('metrika.consent.allow')}</span></Typography>
            </button>
          )}
          {choice === 'undecided' && (
            <button
              type="button"
              className="min-h-11 rounded-md border border-slate-600 px-4 text-slate-200 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
              data-metrika-action="necessary"
              onClick={() => choose('necessary')}
            >
              <Typography asChild variant="controlWrap"><span>{t('metrika.consent.necessary')}</span></Typography>
            </button>
          )}
          {choice === 'allowed' && (
            <button
              type="button"
              className="min-h-11 rounded-md border border-slate-600 px-4 text-slate-200 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
              data-metrika-action="revoke"
              onClick={() => {
                try { window.localStorage.setItem('anomaly-detector:metrika-consent', 'necessary') } catch { /* reload still disables this page */ }
                window.location.reload()
              }}
            >
              <Typography asChild variant="controlWrap"><span>{t('metrika.consent.revoke')}</span></Typography>
            </button>
          )}
        </div>
      </div>
    </aside>
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
