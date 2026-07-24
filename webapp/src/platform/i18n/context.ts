import { createContext } from 'react'

import type { Locale, TranslationKey } from './translations'

export type I18nContextValue = {
  locale: Locale
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)
