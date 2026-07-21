import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'

import { defaultLocale, translations, type Locale, type TranslationKey } from './translations'

type I18nContextValue = {
  locale: Locale
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

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

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider')
  }
  return context
}
