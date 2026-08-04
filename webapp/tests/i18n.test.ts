import { expect, test } from 'bun:test'

import { translate } from '../src/platform/i18n'

test('translates from the Russian fallback and interpolates every placeholder', () => {
  expect(translate('auth.title')).toBe('Вход')
  expect(translate('lobby.player.label', { seat: 3 })).toBe('Игрок 3')
  expect(translate('profile.statistics.title')).toBe('ОСНОВНАЯ СТАТИСТИКА')
  expect(translate('rules.title')).toBe('Справочник правил')
  expect(translate('tender.phaseProgress.current', {
    current: 5,
    total: 6,
    label: 'Анализ модели',
  })).toBe('Этап 5 из 6 · Анализ модели')
  expect(translate('missing.translation.key')).toBe('missing.translation.key')
})
