// THROWAWAY #56 local mechanics only; it has no API, auth, uploads, or trusted persistence.
// ../../../backend stays correct when promoted to scripts/experiments/bots-offline.
import type { TenderCommand } from '@anomaly-detector/contracts'
import { chooseBotCommand } from '../../../backend/src/modules/tender/application/bots'
import { createTenderService } from '../../../backend/src/modules/tender/application/tender-service'
import { createInMemoryTenderStore } from '../../../backend/src/modules/tender/infrastructure/in-memory-tender-store'

type ScenarioName = 'v2-easy' | 'v2-hard' | 'legacy-v1'
type Scenario = Readonly<{ difficulty: 'easy' | 'hard'; name: ScenarioName; ruleset: 'tender-v1' | 'tender-v2'; strategyVersion: 'bot-v1' | 'bot-v2' }>
type Event = Readonly<{ command: TenderCommand; kind: 'command' } | { at: string; kind: 'deadline' }>
type PolicyLatency = Record<string, { calls: number; maxMs: number; totalMs: number }>
type Saved = Readonly<{ events: Event[]; formatVersion: 1; policyLatency: PolicyLatency; scenario: Scenario }>

const storageKey = 'offline-prototype-transcript'
const initialTime = '2026-09-07T00:00:00.000Z'
const scenarios: Record<ScenarioName, Scenario> = {
  'legacy-v1': { difficulty: 'easy', name: 'legacy-v1', ruleset: 'tender-v2', strategyVersion: 'bot-v1' },
  'v2-easy': { difficulty: 'easy', name: 'v2-easy', ruleset: 'tender-v2', strategyVersion: 'bot-v2' },
  'v2-hard': { difficulty: 'hard', name: 'v2-hard', ruleset: 'tender-v2', strategyVersion: 'bot-v2' },
}

const scenarioForLocation = (): Scenario => {
  const requested = new URL(location.href).searchParams.get('scenario')
  if (!requested || !(requested in scenarios)) throw new Error(`Unsupported local scenario ${requested ?? ''}`)
  return scenarios[requested as ScenarioName]
}

const parseSaved = (input: string | null, scenario: Scenario): Saved | undefined => {
  if (!input) return undefined
  const parsed = JSON.parse(input) as Partial<Saved>
  if (parsed.formatVersion !== 1 || !parsed.scenario || !Array.isArray(parsed.events)
    || parsed.scenario.ruleset !== scenario.ruleset || parsed.scenario.strategyVersion !== scenario.strategyVersion
    || parsed.scenario.difficulty !== scenario.difficulty || parsed.scenario.name !== scenario.name) {
    throw new Error('Unsupported persisted local Tender transcript')
  }
  return parsed as Saved
}

const createSession = async (scenario: Scenario) => {
  let now = new Date(initialTime)
  const engine = createTenderService({
    now: () => now,
    seedGenerator: () => `offline-prototype:${scenario.name}`,
    store: createInMemoryTenderStore(),
  })
  const players = [
    { id: 'local-human', tiePriority: 1 },
    { bot: { difficulty: scenario.difficulty, strategyVersion: scenario.strategyVersion }, id: 'local-bot', tiePriority: 2 },
  ]
  const { tenderId } = await engine.createTender({ players, ruleset: scenario.ruleset })
  return {
    advanceDeadline: async (at: string) => {
      now = new Date(at)
      if ((await engine.advanceDueTenders({ limit: 10, now })).advancedTenderIds.length !== 1) throw new Error('Local deadline did not progress')
    },
    engine, players, tenderId,
  }
}

const commandFor = async (session: Awaited<ReturnType<typeof createSession>>, scenario: Scenario, index: number, policyLatency: PolicyLatency) => {
  for (const player of session.players) {
    const view = await session.engine.readTenderView({ playerId: player.id, tenderId: session.tenderId })
    const startedAt = performance.now()
    const command = chooseBotCommand(view, {
      commandId: `offline:${scenario.name}:${index}:${player.id}`,
      difficulty: player.bot?.difficulty ?? 'easy',
      playerId: player.id,
      seed: `offline-policy:${scenario.name}:${player.id}`,
      strategyVersion: player.bot?.strategyVersion ?? 'bot-v1',
    })
    const key = player.bot?.strategyVersion ?? 'human-v1-baseline'
    const elapsed = performance.now() - startedAt
    const previous = policyLatency[key] ?? { calls: 0, maxMs: 0, totalMs: 0 }
    policyLatency[key] = { calls: previous.calls + 1, maxMs: Math.max(previous.maxMs, elapsed), totalMs: previous.totalMs + elapsed }
    if (command) return command
  }
  return null
}

const replay = async (saved: Saved) => {
  const session = await createSession(saved.scenario)
  for (const event of saved.events) {
    if (event.kind === 'command') await session.engine.execute(event.command)
    else await session.advanceDeadline(event.at)
  }
  return session
}

const nearestDeadline = async (session: Awaited<ReturnType<typeof createSession>>) => {
  const views = await Promise.all(session.players.map((player) => session.engine.readTenderView({ playerId: player.id, tenderId: session.tenderId })))
  const dueAt = views.map((view) => view.dueAt).find((value): value is string => value !== null && value !== undefined)
  if (!dueAt) throw new Error('No local command or deadline')
  return dueAt
}

const finish = (result: Record<string, unknown>) => {
  document.body.textContent = `OFFLINE PROTOTYPE ONLY\n${JSON.stringify(result)}`
  document.body.dataset.result = 'pass'
  console.log('OFFLINE_PROTOTYPE_PASS', result)
}

async function run() {
  const scenario = scenarioForLocation()
  const saved = parseSaved(localStorage.getItem(storageKey), scenario)
  const session = saved ? await replay(saved) : await createSession(scenario)
  const events = saved?.events ?? []
  const policyLatency = saved?.policyLatency ?? {}
  for (let index = events.length; index < 240; index += 1) {
    const view = await session.engine.readTenderView({ playerId: 'local-human', tenderId: session.tenderId })
    if (view.phase === 'complete') return finish({ events: events.length, policyLatency, reloaded: Boolean(saved), rounds: view.round, ruleset: scenario.ruleset, scenario: scenario.name, strategyVersion: scenario.strategyVersion })
    const command = await commandFor(session, scenario, index, policyLatency)
    if (command) {
      try {
        await session.engine.execute(command)
      } catch (error) {
        throw new Error(`${scenario.name} event ${index} ${view.phase}/${command.type}: ${error instanceof Error ? error.message : String(error)}`)
      }
      events.push({ command, kind: 'command' })
    } else {
      const at = await nearestDeadline(session)
      await session.advanceDeadline(at)
      events.push({ at, kind: 'deadline' })
    }
    if (!saved && events.length === 12) {
      localStorage.setItem(storageKey, JSON.stringify({ events, formatVersion: 1, policyLatency, scenario } satisfies Saved))
      document.body.dataset.result = 'checkpoint'
      document.body.textContent = `OFFLINE PROTOTYPE CHECKPOINT\n${scenario.name}`
      return
    }
  }
  throw new Error('Local simulation exceeded 240 bounded events')
}

void run().catch((error: unknown) => {
  document.body.textContent = `OFFLINE PROTOTYPE FAILED\n${String(error)}`
  document.body.dataset.result = 'guard-failed'
  console.error('OFFLINE_PROTOTYPE_FAIL', error)
})
