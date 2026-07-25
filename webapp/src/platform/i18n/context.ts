import { createContext } from 'react'

import type { TranslationKey } from './translations'

export type I18nContextValue = {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)
