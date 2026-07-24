import { useMemo, type PropsWithChildren } from 'react'

import { I18nContext, type I18nContextValue } from './context'
import { defaultLocale, translations, type Locale } from './translations'

export function I18nProvider({ children, locale = defaultLocale }: PropsWithChildren<{ locale?: Locale }>) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, params) => {
      const dict = translations[locale] ?? translations[defaultLocale]
      let text: string = (dict as Record<string, string>)[key] ?? key
      if (params) {
        for (const [param, replacement] of Object.entries(params)) {
          text = text.replace(`{${param}}`, String(replacement))
        }
      }
      return text
    },
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
