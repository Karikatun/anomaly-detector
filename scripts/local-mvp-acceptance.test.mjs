import { describe, expect, test } from 'bun:test'

import {
  assertLocalAcceptanceDatabaseUrl,
  assertSafeLocalMvpAcceptanceEvidence,
  buildLocalMvpAcceptanceEvidence,
  createTenderTimeline,
  localDockerEndpointFromContextInspect,
  localMvpAcceptanceProjectName,
  localMvpAcceptanceProcessEnvironment,
  parseBlockerSelection,
  parseFindingSelection,
  parseLocalMvpAcceptanceArguments,
  parseStepStatus,
} from './local-mvp-acceptance-support.mjs'

describe('local MVP acceptance arguments', () => {
  test('requires one supported player count before side effects', () => {
    expect(parseLocalMvpAcceptanceArguments(['--players', '2'])).toEqual({
      browser: 'chromium',
      help: false,
      players: 2,
      smoke: false,
    })
    expect(parseLocalMvpAcceptanceArguments([
      '--browser=firefox',
      '--players=4',
      '--smoke',
    ])).toEqual({
      browser: 'firefox',
      help: false,
      players: 4,
      smoke: true,
    })

    for (const value of ['0', '1', '5', 'three', '']) {
      expect(() => parseLocalMvpAcceptanceArguments(['--players', value])).toThrow(
        '--players must be 2, 3, or 4',
      )
    }
    expect(() => parseLocalMvpAcceptanceArguments([])).toThrow('--players is required')
    expect(() => parseLocalMvpAcceptanceArguments(['--players', '2', '--unknown'])).toThrow(
      'Unknown argument',
    )
    expect(() => parseLocalMvpAcceptanceArguments([
      '--players', '2', '--players', '3',
    ])).toThrow('--players must be provided once')
  })

  test('allows help without a player count', () => {
    expect(parseLocalMvpAcceptanceArguments(['--help'])).toEqual({
      browser: 'chromium',
      help: true,
      players: undefined,
      smoke: false,
    })
  })
})

describe('local MVP acceptance isolation', () => {
  test('removes ambient production, provider, Docker, database, proxy, and artifact selectors', () => {
    expect(localMvpAcceptanceProcessEnvironment({
      ADMIN_USER_IDS: 'production-admin',
      ANALYTICS_ENABLED: 'true',
      ASTRO_TELEMETRY_DISABLED: '0',
      AWS_SECRET_ACCESS_KEY: 'cloud-secret',
      BUN_OPTIONS: '--preload=foreign.ts',
      ASTRO_TELEMETRY_DISABLED: '0',
      AWS_SECRET_ACCESS_KEY: 'cloud-secret',
      BUN_OPTIONS: '--preload=foreign.ts',
      COMPOSE_FILE: '/tmp/production.yml',
      COMPOSE_PROJECT_NAME: 'production',
      DATABASE_URL: 'postgresql://production.example/app',
      DOCKER_CONTEXT: 'production',
      DOCKER_HOST: 'ssh://operator@production.example',
      E2E_KEEP_DOCKER: '1',
      E2E_SKIP_DOCKER: '1',
      GH_TOKEN: 'remote-secret',
      GIT_DIR: '/tmp/foreign-repository',
      GIT_DIR: '/tmp/foreign-repository',
      HTTPS_PROXY: 'http://proxy.example:8443',
      JWT_SECRET: 'production-secret',
      MAIL_SMTP_ENABLED: 'true',
      MAIL_SMTP_PASSWORD: 'mail-secret',
      NODE_EXTRA_CA_CERTS: '/tmp/foreign-ca.pem',
      NODE_OPTIONS: '--require=/tmp/foreign.js',
      NODE_EXTRA_CA_CERTS: '/tmp/foreign-ca.pem',
      NODE_OPTIONS: '--require=/tmp/foreign.js',
      PUBLIC_ANALYTICS_API_URL: 'https://analytics.example',
      TEST_DATABASE_URL: 'postgresql://production.example/app_test',
      VITE_API_URL: 'https://api.example',
      YANDEX_OAUTH_CLIENT_SECRET: 'oauth-secret',
      YANDEX_STORAGE_SECRET_ACCESS_KEY: 'storage-secret',
      KEEP: 'value',
      PATH: '/usr/bin',
    }, {
      COMPOSE_PROJECT_NAME: 'anomaly-mvp-local-test',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
      MAIL_SMTP_ENABLED: 'false',
    })).toEqual({
      COMPOSE_PROJECT_NAME: 'anomaly-mvp-local-test',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
      MAIL_SMTP_ENABLED: 'false',
      PATH: '/usr/bin',
    })
  })

  test('accepts only a local Unix-socket Docker context', () => {
    expect(localDockerEndpointFromContextInspect(JSON.stringify([{
      Endpoints: { docker: { Host: 'unix:///Users/test/.docker/run/docker.sock' } },
    }]))).toBe('unix:///Users/test/.docker/run/docker.sock')

    for (const host of [
      'tcp://production.example:2376',
      'ssh://operator@production.example',
      'unix://production.example/docker.sock',
    ]) {
      expect(() => localDockerEndpointFromContextInspect(JSON.stringify([{
        Endpoints: { docker: { Host: host } },
      }]))).toThrow('local Unix-socket Docker context')
    }
  })

  test('builds a bounded invocation-scoped Compose project name', () => {
    expect(localMvpAcceptanceProjectName('a1b2c3d4e5f6', 42, 'c0ffee12')).toBe(
      'anomaly-mvp-a1b2c3d4e5f6-42-c0ffee12',
    )
    expect(() => localMvpAcceptanceProjectName('repo', 42, 'c0ffee12')).toThrow(
      'repository hash',
    )
  })

  test('accepts only loopback PostgreSQL targets with a test database and bounded query', () => {
    for (const url of [
      'postgresql://user:pass@localhost:5432/anomaly_detector_test?schema=public',
      'postgres://user:pass@127.0.0.1:5432/anomaly_detector_test',
      'postgresql://user:pass@[::1]:5432/anomaly_detector_test',
    ]) {
      expect(() => assertLocalAcceptanceDatabaseUrl(url)).not.toThrow()
    }

    for (const url of [
      'postgresql://user:pass@db.internal:5432/anomaly_detector_test',
      'postgresql://user:pass@127.0.0.2:5432/anomaly_detector_test',
      'postgresql://user:pass@localhost:5432/anomaly_detector',
      'postgresql://user:pass@localhost:5432/anomaly_detector_test?host=production.example',
      'https://localhost/anomaly_detector_test',
      'not-a-url',
    ]) {
      expect(() => assertLocalAcceptanceDatabaseUrl(url)).toThrow(
        'loopback *_test PostgreSQL target',
      )
    }
  })
})

describe('local MVP acceptance observations', () => {
  test('records only aggregate phase durations for a normally completed Tender', () => {
    const timeline = createTenderTimeline(2)
    timeline.observe([snapshot({
      createdAt: '2026-08-25T10:00:00.000Z',
      phase: 'access-slot-selection',
      round: 1,
      updatedAt: '2026-08-25T10:00:00.000Z',
    })])
    timeline.observe([snapshot({
      createdAt: '2026-08-25T10:00:00.000Z',
      phase: 'power-allocation',
      round: 1,
      updatedAt: '2026-08-25T10:01:00.000Z',
    })])
    timeline.observe([snapshot({
      createdAt: '2026-08-25T10:00:00.000Z',
      phase: 'complete',
      round: 5,
      updatedAt: '2026-08-25T10:45:00.000Z',
    })])

    expect(timeline.summary()).toEqual({
      matchOutcome: 'completed_normally',
      observedPlayerCount: 2,
      phaseDurations: [
        { durationMs: 60_000, phase: 'access-slot-selection', round: 1 },
        { durationMs: 2_640_000, phase: 'power-allocation', round: 1 },
      ],
      phaseTimingCoverage: 'partial',
      tenderCount: 1,
      totalDurationMs: 2_700_000,
    })
  })

  test('fails closed for multiple Tenders, early completion, or player-count mismatch', () => {
    const ambiguous = createTenderTimeline(3)
    ambiguous.observe([snapshot(), snapshot()])
    expect(ambiguous.summary().matchOutcome).toBe('ambiguous')

    const early = createTenderTimeline(4)
    early.observe([snapshot({ endedEarly: true, phase: 'complete', playerCount: 4 })])
    expect(early.summary().matchOutcome).toBe('completed_early')

    const mismatch = createTenderTimeline(4)
    mismatch.observe([snapshot({ phase: 'complete', playerCount: 3 })])
    expect(mismatch.summary().matchOutcome).toBe('player_count_mismatch')
  })

  test('accepts a complete ordered timeline with domain-level auto-skips', () => {
    const timeline = createTenderTimeline(3)
    const observed = [
      ['access-slot-selection', 1],
      ['power-allocation', 1],
      ['contracts', 1],
      ['access-slot-selection', 2],
      ['power-allocation', 2],
      ['contracts', 2],
      ['access-slot-selection', 3],
      ['power-allocation', 3],
      ['contracts', 3],
      ['access-slot-selection', 4],
      ['power-allocation', 4],
      ['contracts', 4],
      ['access-slot-selection', 5],
      ['power-allocation', 5],
      ['contracts', 5],
      ['final-scientific-model', 5],
      ['complete', 5],
    ]
    observed.forEach(([phase, round], index) => {
      timeline.observe([snapshot({
        phase,
        playerCount: 3,
        round,
        updatedAt: new Date(Date.parse('2026-08-25T10:00:00.000Z') + index * 1_000),
      })])
    })

    expect(timeline.summary()).toMatchObject({
      matchOutcome: 'completed_normally',
      phaseTimingCoverage: 'complete',
      tenderCount: 1,
    })
  })

  test('keeps timing coverage partial when a mandatory round phase was not observed', () => {
    const timeline = createTenderTimeline(3)
    const observed = [
      ['access-slot-selection', 1],
      ['power-allocation', 1],
      ['access-slot-selection', 2],
      ['power-allocation', 2],
      ['access-slot-selection', 3],
      ['access-slot-selection', 4],
      ['power-allocation', 4],
      ['access-slot-selection', 5],
      ['power-allocation', 5],
      ['final-scientific-model', 5],
      ['complete', 5],
    ]
    observed.forEach(([phase, round], index) => {
      timeline.observe([snapshot({
        phase,
        playerCount: 3,
        round,
        updatedAt: new Date(Date.parse('2026-08-25T10:00:00.000Z') + index * 1_000),
      })])
    })

    expect(timeline.summary().phaseTimingCoverage).toBe('partial')
  })
})

describe('local MVP acceptance questionnaire and evidence', () => {
  test('accepts enum-only questionnaire answers', () => {
    expect(parseStepStatus('п')).toBe('pass')
    expect(parseStepStatus('fail')).toBe('fail')
    expect(parseStepStatus('н')).toBe('not_run')
    expect(() => parseStepStatus('вроде нормально')).toThrow('pass, fail, or not_run')

    expect(parseFindingSelection('defect:engineering defect:engineering abuse:security')).toEqual([
      { category: 'abuse', count: 1, owner: 'security' },
      { category: 'defect', count: 2, owner: 'engineering' },
    ])
    expect(parseFindingSelection('')).toEqual([])
    expect(() => parseFindingSelection('defect:alice')).toThrow('finding category:owner')

    expect(parseBlockerSelection('device, mail device')).toEqual(['device', 'mail'])
    expect(parseBlockerSelection('')).toEqual([])
    expect(() => parseBlockerSelection('room-ABC123')).toThrow('blocker category')
  })

  test('builds a fixed sanitized envelope only after cleanup is confirmed', () => {
    const evidence = buildLocalMvpAcceptanceEvidence({
      blockerCategories: [],
      browser: 'chromium',
      browserVersion: '140.0.7339.16',
      cleanupConfirmed: true,
      completedAt: new Date('2026-08-25T11:00:00.000Z'),
      findingEntries: [],
      incidentOutcome: 'none',
      journey: {
        feedbackReceipt: 'pass',
        landingCta: 'pass',
        passwordRegistration: 'pass',
        recoveryEmailOffer: 'pass',
        tutorialFirstPlayerValue: 'pass',
      },
      observation: {
        disposableAccountCount: 2,
        feedbackReportCount: 1,
        matchOutcome: 'completed_normally',
        observedPlayerCount: 2,
        phaseDurations: expectedPhaseDurations(),
        phaseTimingCoverage: 'complete',
        roomCount: 1,
        tenderCount: 1,
        totalDurationMs: 2_700_000,
        tutorialCompletionCount: 1,
      },
      playerCount: 2,
      revision: 'a'.repeat(40),
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
    })

    expect(evidence).toMatchObject({
      artifactRetention: 'ephemeral_cleanup_confirmed',
      browserClass: 'desktop_chromium',
      browserVersion: '140.0.7339.16',
      evidenceVersion: 1,
      kind: 'local_mvp_human_acceptance',
      playerCount: 2,
      productionAcceptance: 'not_proven',
      revision: 'a'.repeat(40),
      scope: 'local_isolated',
      status: 'pass',
    })
    expect(evidence.externalGates).toEqual({
      legalOperationsSignOff: 'not_run',
      liveMailAndRecovery: 'not_run',
      physicalDeviceMatrix: 'not_run',
      productionDeployment: 'not_used',
      supportAndIncidentRouting: 'not_run',
    })
    expect(() => assertSafeLocalMvpAcceptanceEvidence(evidence)).not.toThrow()
    expect(() => buildLocalMvpAcceptanceEvidence({
      ...validEvidenceInput(),
      cleanupConfirmed: false,
    })).toThrow('confirmed cleanup')
  })

  test('rejects secret-bearing or identifier-bearing evidence', () => {
    const safe = buildLocalMvpAcceptanceEvidence(validEvidenceInput())
    for (const leaked of [
      { login: 'player-one' },
      { roomCode: 'ABC123' },
      { note: 'https://example.test/private' },
      { note: 'player@example.test' },
      { token: 'must-not-appear' },
      { tenderId: '018f8f9a-3d12-7abc-8def-1234567890ab' },
    ]) {
      expect(() => assertSafeLocalMvpAcceptanceEvidence({ ...safe, leaked })).toThrow(
        'unsafe evidence',
      )
    }
  })

  test('does not pass without the exact disposable run aggregates', () => {
    const input = validEvidenceInput()
    const missingFeedback = buildLocalMvpAcceptanceEvidence({
      ...input,
      observation: { ...input.observation, feedbackReportCount: 0 },
    })
    const extraAccount = buildLocalMvpAcceptanceEvidence({
      ...input,
      observation: { ...input.observation, disposableAccountCount: 4 },
    })

    expect(missingFeedback.status).toBe('fail')
    expect(extraAccount.status).toBe('fail')
    expect(() => buildLocalMvpAcceptanceEvidence({
      ...input,
      browserVersion: 'unknown',
    })).toThrow('bounded browser version')
  })
})

function snapshot(overrides = {}) {
  return {
    createdAt: '2026-08-25T10:00:00.000Z',
    endedEarly: false,
    phase: 'access-slot-selection',
    playerCount: 2,
    round: 1,
    updatedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  }
}

function expectedPhaseDurations() {
  const phases = [
    'access-slot-selection',
    'power-allocation',
    'reconnaissance',
    'laboratory',
    'model-analysis',
    'contracts',
  ]
  return [
    ...Array.from({ length: 5 }, (_, roundIndex) => phases.map((phase) => ({
      durationMs: 1_000,
      phase,
      round: roundIndex + 1,
    }))).flat(),
    { durationMs: 1_000, phase: 'final-scientific-model', round: 5 },
  ]
}

function validEvidenceInput() {
  return {
    blockerCategories: [],
    browser: 'firefox',
    browserVersion: '141.0',
    cleanupConfirmed: true,
    completedAt: new Date('2026-08-25T11:00:00.000Z'),
    findingEntries: [],
    incidentOutcome: 'none',
    journey: {
      feedbackReceipt: 'pass',
      landingCta: 'pass',
      passwordRegistration: 'pass',
      recoveryEmailOffer: 'pass',
      tutorialFirstPlayerValue: 'pass',
    },
    observation: {
      disposableAccountCount: 3,
      feedbackReportCount: 1,
      matchOutcome: 'completed_normally',
      observedPlayerCount: 3,
      phaseDurations: expectedPhaseDurations(),
      phaseTimingCoverage: 'complete',
      roomCount: 1,
      tenderCount: 1,
      totalDurationMs: 2_800_000,
      tutorialCompletionCount: 1,
    },
    playerCount: 3,
    revision: 'b'.repeat(40),
    startedAt: new Date('2026-08-25T10:00:00.000Z'),
  }
}
