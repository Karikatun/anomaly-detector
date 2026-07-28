import { expect, test } from 'bun:test'

import type { TenderCommandInput } from '../src/features/tender/commands'
import {
  getTenderCommandErrorMessage,
  getWaitingForTurnDescription,
} from '../src/features/tender/tender-command-feedback'
import { ApiRequestError } from '../src/platform/api'

const acceptedThesis: TenderCommandInput = {
  type: 'submit-thesis',
  signalId: 'aster',
  fieldType: 'inertial',
  polarity: 'positive',
}

test('accepted Thesis wins over a stale invalid-state response', () => {
  expect(getTenderCommandErrorMessage({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(409, 'CONFLICT', 'Model analysis is not available to this Player'),
    latestView: {
      version: 11,
      publicTheses: [{
        correct: true,
        fieldType: 'inertial',
        playerId: 'player-a',
        polarity: 'positive',
        signalId: 'aster',
        verification: 'standard',
      }],
    },
    startingView: {
      version: 10,
      publicTheses: [],
    },
  })).toBeNull()
})

test('a real invalid-state response is localized when the Thesis was not accepted', () => {
  expect(getTenderCommandErrorMessage({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(409, 'CONFLICT', 'Model analysis is not available to this Player'),
    latestView: {
      version: 11,
      publicTheses: [],
    },
    startingView: {
      version: 10,
      publicTheses: [],
    },
  })).toBe('Время действия истекло или ход уже завершён. Проверьте текущее состояние игры.')
})

test('an older identical Thesis does not hide a real invalid-state response', () => {
  const existingThesis = {
    correct: true,
    fieldType: 'inertial' as const,
    playerId: 'player-a',
    polarity: 'positive' as const,
    signalId: 'aster' as const,
    verification: 'standard' as const,
  }
  expect(getTenderCommandErrorMessage({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(409, 'CONFLICT', 'Model analysis is not available to this Player'),
    latestView: {
      version: 11,
      publicTheses: [existingThesis],
    },
    startingView: {
      version: 10,
      publicTheses: [existingThesis],
    },
  })).toBe('Время действия истекло или ход уже завершён. Проверьте текущее состояние игры.')
})

test('an unsubmitted final Scientific Model is described as a local draft', () => {
  expect(getWaitingForTurnDescription('final-scientific-model', 'Игрок 2')).toBe(
    'Сейчас действует Игрок 2. Ваш черновик финальной модели сохранён только в этой форме и ещё не отправлен.',
  )
})

test('a submitted final Scientific Model is confirmed by the server state', () => {
  expect(getWaitingForTurnDescription('final-scientific-model', 'Игрок 2', true)).toBe(
    'Сейчас действует Игрок 2. Ваша финальная модель отправлена и принята сервером.',
  )
})
