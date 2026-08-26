import type { TenderView } from '@anomaly-detector/contracts'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AuthContext, type AuthContextValue } from '../src/features/auth/context'
import { PhasePanel } from '../src/features/tender/TenderPage'

const completedViewWithoutAudit: TenderView = {
  knownSignals: [],
  phase: 'complete',
  players: [{
    budget: 2,
    contractPowerRestriction: 0,
    displayName: 'Участник',
    playerId: 'player-a',
    rating: 0,
  }],
  privateMeasurements: [],
  privateRawTelemetrySignals: [],
  privateSamples: [],
  privateWorkingModel: { signals: {} },
  publicContracts: [],
  publicLaboratoryResults: [],
  publicTheses: [],
  round: 1,
  ruleset: 'tender-v2',
  serverTime: '2026-08-24T12:00:00.000Z',
  tenderId: '00000000-0000-4000-8000-000000000001',
  version: 1,
}

const unavailableTransport: AuthContextValue['transport'] = {
  request: async () => {
    throw new Error('Transport must not be used while rendering a terminal phase')
  },
}

const auth: AuthContextValue = {
  deleteAccount: async () => undefined,
  isAuthenticated: true,
  isBootstrapping: false,
  login: async () => undefined,
  logout: async () => undefined,
  register: async () => undefined,
  retrySession: async () => undefined,
  sessionError: null,
  startOAuth: async () => undefined,
  transport: unavailableTransport,
  updateProfile: async () => undefined,
  user: {
    createdAt: '2026-08-24T12:00:00.000Z',
    displayName: 'Участник',
    id: 'player-a',
    locale: 'ru',
    login: 'audit-player',
  },
}

test('renders a recoverable terminal state instead of waiting forever for an omitted completed audit', () => {
  const html = renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <PhasePanel
        disabled={false}
        error={null}
        onAuditRetry={() => undefined}
        onCommand={async () => undefined}
        onReturnToHistory={() => undefined}
        onSaveWorkingModel={async () => undefined}
        view={completedViewWithoutAudit}
        workingModelDialog={{
          onOpenChange: () => undefined,
          onSaveStatusChange: () => undefined,
          open: false,
          openDisabled: false,
        }}
      />
    </AuthContext.Provider>,
  )

  expect(html).toContain('Итоговый аудит недоступен')
  expect(html).toContain('Повторить')
  expect(html).toContain('В Историю матчей')
  expect(html).not.toContain('Ожидание данных аудита')
})
