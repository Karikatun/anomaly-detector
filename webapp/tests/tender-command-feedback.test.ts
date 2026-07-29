import { expect, test } from 'bun:test'

import type { TenderCommandInput } from '../src/features/tender/commands'
import {
  getTenderCommandErrorKey,
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
  expect(getTenderCommandErrorKey({
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
  expect(getTenderCommandErrorKey({
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
  })).toBe('tender.command.conflict')
})

test('an accepted private Thesis wins over a stale invalid-state response', () => {
  expect(getTenderCommandErrorKey({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(409, 'CONFLICT', 'Model analysis is already completed'),
    latestView: {
      version: 11,
      publicTheses: [],
      privateTheses: [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: false,
        id: 'r1-player-a-thesis-1',
        polarity: 'positive',
        polarityCorrect: false,
        round: 1,
        signalId: 'aster',
      }],
    },
    startingView: {
      version: 10,
      publicTheses: [],
      privateTheses: [],
    },
  })).toBeNull()
})

test('an expired Tender command uses a specific localized message', () => {
  expect(getTenderCommandErrorKey({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(409, 'TENDER_DEADLINE_EXPIRED', 'Tender deadline expired'),
    latestView: {
      version: 10,
      publicTheses: [],
    },
    startingView: {
      version: 10,
      publicTheses: [],
    },
  })).toBe('tender.command.deadlineExpired')
})

test('stale Contract evidence uses a recoverable localized message', () => {
  expect(getTenderCommandErrorKey({
    actorId: 'player-a',
    command: {
      contractId: 'contract-1',
      evidenceTestIds: ['r1-t1'],
      type: 'submit-contract-bid',
    },
    error: new ApiRequestError(409, 'TENDER_EVIDENCE_UNAVAILABLE', 'raw backend message'),
    latestView: { version: 11, publicTheses: [] },
    startingView: { version: 10, publicTheses: [] },
  })).toBe('tender.command.evidenceUnavailable')
})

test('an unknown backend message never reaches the player', () => {
  expect(getTenderCommandErrorKey({
    actorId: 'player-a',
    command: acceptedThesis,
    error: new ApiRequestError(500, 'INTERNAL_ERROR', 'Prisma transaction failed'),
    latestView: {
      version: 10,
      publicTheses: [],
    },
    startingView: {
      version: 10,
      publicTheses: [],
    },
  })).toBe('tender.command.fallback')
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
  expect(getTenderCommandErrorKey({
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
  })).toBe('tender.command.conflict')
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
