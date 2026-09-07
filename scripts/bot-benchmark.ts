/**
 * #55 reproducible local bot benchmark. It creates no database records or network traffic.
 *
 * PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH" bun scripts/bot-benchmark.ts --suite baseline
 */
import { createHash } from 'node:crypto'
import { arch, cpus, platform, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'

import type { TenderAuditView, TenderCommand, TenderView } from '@anomaly-detector/contracts'
import { createTenderModule } from '../backend/src/modules/tender'
import { chooseBotCommand, type BotDifficulty } from '../backend/src/modules/tender/application/bots'
import {
  candidateConsensus,
  candidateDirectedConsensus,
  candidatesFromView,
} from '../backend/src/modules/tender/application/bots/candidates'
import { resolvePublicResult, signalIds } from '../backend/src/modules/tender/domain/anomaly-configuration'

type Suite = 'baseline' | 'holdout'
type Variant = 'easy' | 'hard' | 'mixed'
type Composition = Readonly<{ humans: number; bots: number }>
export type BenchmarkCase = Readonly<{ seed: string; composition: Composition; permutation: number; variant: Variant }>
type Case = BenchmarkCase
type Player = Readonly<{ id: string; kind: 'human' | 'bot'; difficulty?: BotDifficulty; strategyVersion: 'bot-v1' | 'bot-v2' }>

const baselineSeeds = Array.from({ length: 12 }, (_, index) => `bots-baseline-20260907-${index}`)
const holdoutSeeds = Array.from({ length: 8 }, (_, index) => `bots-holdout-20260907-${index}`)
const compositions: readonly Composition[] = [
  { humans: 1, bots: 1 }, { humans: 1, bots: 2 }, { humans: 1, bots: 3 },
  { humans: 2, bots: 1 }, { humans: 2, bots: 2 }, { humans: 3, bots: 1 },
]
const variants: readonly Variant[] = ['easy', 'hard', 'mixed']
const maxSteps = 360
const initialTime = new Date('2026-09-07T00:00:00.000Z')
const expectedHoldoutCases = holdoutSeeds.length * compositions.reduce((total, composition) =>
  total + ((composition.humans + composition.bots) * variants.length), 0)
const approvedHoldoutThresholds = {
  completionRate: 1,
  consensusPrecision: 1,
  easyPropertyCoverage: 0.95,
  hardMeanAdvantage: 5,
  hardMeanAdvantageCiLower: 0,
  observedRssBytes: 512 * 1024 * 1024,
  pooledDecisionP95Ms: 10,
} as const

const caseKey = (caseInput: Case) => `${caseInput.seed}:${caseInput.composition.humans}+${caseInput.composition.bots}:${caseInput.permutation}:${caseInput.variant}`
export const holdoutCaseMatrix: readonly Case[] = holdoutSeeds.flatMap((seed) => compositions.flatMap((composition) => variants.flatMap((variant) =>
  Array.from({ length: composition.humans + composition.bots }, (_, permutation) => ({ composition, permutation, seed, variant })),
)))
const expectedHoldoutCaseKeys = new Set(holdoutCaseMatrix.map(caseKey))

export const assertCompleteHoldoutMatrix = (cases: readonly Case[]) => {
  const actualKeys = cases.map(caseKey)
  const actualKeySet = new Set(actualKeys)
  if (actualKeys.length !== actualKeySet.size) throw new Error('Duplicate combined holdout case')
  if (actualKeySet.size !== expectedHoldoutCaseKeys.size || [...actualKeySet].some((key) => !expectedHoldoutCaseKeys.has(key))) {
    throw new Error('Combined holdout does not match the frozen case matrix')
  }
}

const environment = () => ({
  arch: arch(),
  bunVersion: Bun.version,
  cpuModel: cpus()[0]?.model ?? 'unknown',
  platform: platform(),
  systemMemoryBytes: totalmem(),
})

const stableJson = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
    : JSON.stringify(value)

const percentile = (values: number[], percentileValue: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]!
}

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length

const studentTCritical95 = (degreesOfFreedom: number) => ({
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447,
  7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179,
}[degreesOfFreedom] ?? 1.96)

export const ci95 = (values: number[]) => {
  if (values.length === 0) return { mean: null, n: 0, lower: null, upper: null }
  if (values.length === 1) return { mean: values[0]!, n: 1, lower: null, upper: null }
  const average = mean(values)
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1)
  const margin = studentTCritical95(values.length - 1) * Math.sqrt(variance / values.length)
  return { mean: average, n: values.length, lower: average - margin, upper: average + margin }
}

const strategyFor = (_difficulty: BotDifficulty): 'bot-v2' => 'bot-v2'

const playersFor = ({ composition, permutation, variant }: Case): Player[] => {
  const humans = Array.from({ length: composition.humans }, (_, index): Player => ({
    id: `human-${index + 1}`, kind: 'human', strategyVersion: 'bot-v1',
  }))
  const bots = Array.from({ length: composition.bots }, (_, index): Player => {
    const difficulty: BotDifficulty = variant === 'mixed' ? (index % 2 === 0 ? 'easy' : 'hard') : variant
    return { difficulty, id: `bot-${index + 1}`, kind: 'bot', strategyVersion: strategyFor(difficulty) }
  })
  const unordered = [...humans, ...bots]
  const offset = permutation % unordered.length
  return [...unordered.slice(offset), ...unordered.slice(0, offset)]
}

const decisionSeedFor = (caseInput: Case, player: Player) =>
  `bot-decision-20260907:${caseInput.composition.humans}+${caseInput.composition.bots}:${player.id}`

const commandFor = (view: TenderView, player: Player, caseInput: Case, ordinal: number): TenderCommand | null =>
  // The simulated humans intentionally use the fixed v1 public-view policy. No policy sees storage or audit state.
  chooseBotCommand(view, {
    commandId: `benchmark:${ordinal}:${player.id}`,
    difficulty: player.difficulty ?? 'easy',
    playerId: player.id,
    seed: decisionSeedFor(caseInput, player),
    strategyVersion: player.strategyVersion,
  })

const botMetrics = (view: TenderView, audit: TenderAuditView, player: Player, latencies: number[]) => {
  let propertyCorrect = 0
  let propertyInferred = 0
  let interactionCorrect = 0
  let interactionInferred = 0
  const candidates = candidatesFromView(view)
  const properties = candidateConsensus(candidates)
  for (const signalId of signalIds) {
    const claim = properties[signalId]
    if (claim.fieldType) { propertyInferred += 1; propertyCorrect += Number(claim.fieldType === audit.anomalyConfiguration.signals[signalId].fieldType) }
    if (claim.polarity) { propertyInferred += 1; propertyCorrect += Number(claim.polarity === audit.anomalyConfiguration.signals[signalId].polarity) }
  }
  const interactions = candidateDirectedConsensus(candidates)
  for (const sourceSignal of signalIds) for (const receiverSignal of signalIds) {
    if (sourceSignal === receiverSignal) continue
    const inferred = interactions[`${sourceSignal}:${receiverSignal}`]
    if (!inferred) continue
    interactionInferred += 1
    interactionCorrect += Number(inferred === resolvePublicResult(
      audit.anomalyConfiguration.signals[sourceSignal], audit.anomalyConfiguration.signals[receiverSignal],
    ))
  }
  const final = Object.values(audit.finalScientificModelsByPlayer[player.id]?.signals ?? {})
  const finalClaimed = final.reduce((total, signal) => total + Number(signal.fieldType !== undefined) + Number(signal.polarity !== undefined), 0)
  const finalCorrect = final.reduce((total, signal) => total + Number(signal.fieldTypeCorrect === true) + Number(signal.polarityCorrect === true), 0)
  return {
    decisionLatenciesMs: latencies,
    decisionLatencyMs: { max: Math.max(0, ...latencies), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    difficulty: player.difficulty!,
    final: { accuracy: finalClaimed === 0 ? 0 : finalCorrect / finalClaimed, claimed: finalClaimed, correct: finalCorrect },
    interactions: { available: 30, correct: interactionCorrect, coverage: interactionInferred / 30, inferred: interactionInferred, precision: interactionInferred === 0 ? 0 : interactionCorrect / interactionInferred },
    playerId: player.id,
    properties: { available: 12, correct: propertyCorrect, coverage: propertyInferred / 12, inferred: propertyInferred, precision: propertyInferred === 0 ? 0 : propertyCorrect / propertyInferred },
    score: audit.ratingBreakdownByPlayer[player.id]?.total ?? 0,
  }
}

type MatchResult = ReturnType<typeof matchResult>
const matchResult = (input: {
  botMetrics: ReturnType<typeof botMetrics>[]; caseInput: Case; commands: number; hash: string; iterations: number; peakRss: number; cpuMicros: number; timeouts: number
}) => ({
  case: input.caseInput,
  bots: input.botMetrics,
  commands: input.commands,
  cpuMicros: input.cpuMicros,
  hash: input.hash,
  iterations: input.iterations,
  peakRss: input.peakRss,
  timeouts: input.timeouts,
})

async function simulate(caseInput: Case): Promise<MatchResult> {
  let now = new Date(initialTime)
  const tender = createTenderModule({ now: () => now, seedGenerator: () => caseInput.seed })
  const players = playersFor(caseInput)
  const { tenderId } = await tender.createTender({
    players: players.map((player, index) => ({
      id: player.id,
      tiePriority: index + 1,
      ...(player.kind === 'bot' ? { bot: { difficulty: player.difficulty!, strategyVersion: player.strategyVersion } } : {}),
    })),
    ruleset: 'tender-v2',
  })
  const latencies = new Map(players.map((player) => [player.id, [] as number[]]))
  const normalizedCommands: unknown[] = []
  const cpuStart = process.cpuUsage()
  let peakRss = process.memoryUsage().rss
  let commands = 0
  let iterations = 0
  let timeouts = 0
  while (iterations < maxSteps) {
    iterations += 1
    const views = new Map(await Promise.all(players.map(async (player) => [player.id, await tender.readTenderView({ playerId: player.id, tenderId })] as const)))
    if ([...views.values()].every((view) => view.phase === 'complete')) break
    let selected: { command: TenderCommand; view: TenderView } | undefined
    for (const player of players) {
      const view = views.get(player.id)!
      const started = performance.now()
      const command = commandFor(view, player, caseInput, commands + 1)
      latencies.get(player.id)!.push(performance.now() - started)
      if (command) { selected = { command, view }; break }
    }
    if (selected) {
      await tender.execute(selected.command, { expectedVersion: selected.view.version })
      normalizedCommands.push(Object.fromEntries(Object.entries(selected.command).filter(([key]) => key !== 'commandId' && key !== 'tenderId')))
      commands += 1
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
      continue
    }
    const dueDates = [...views.values()].map((view) => view.dueAt).filter((dueAt): dueAt is string => dueAt !== null && dueAt !== undefined)
    if (dueDates.length === 0) throw new Error(`No legal command or deadline for ${caseInput.seed}`)
    now = new Date(Math.min(...dueDates.map((dueAt) => new Date(dueAt).getTime())))
    if (Number.isNaN(now.getTime())) throw new Error(`Invalid deadline for ${caseInput.seed}`)
    const advanced = await tender.advanceDueTenders({ limit: 10, now })
    if (advanced.advancedTenderIds.length === 0) throw new Error(`Deadline did not progress ${caseInput.seed}`)
    timeouts += 1
  }
  if (iterations === maxSteps) throw new Error(`Step bound exceeded for ${caseInput.seed}`)
  const completedViews = new Map(await Promise.all(players.map(async (player) => [player.id, await tender.readTenderView({ playerId: player.id, tenderId })] as const)))
  const completed = completedViews.get(players[0]!.id)!
  if (completed.phase !== 'complete' || !completed.audit || completed.round !== 5) throw new Error(`Tender did not complete five rounds for ${caseInput.seed}`)
  const scores = Object.fromEntries(players.map((player) => [player.id, completed.audit!.ratingBreakdownByPlayer[player.id]?.total ?? 0]))
  const hash = createHash('sha256').update(stableJson({ commands: normalizedCommands, scores })).digest('hex')
  const cpu = process.cpuUsage(cpuStart)
  return matchResult({
    botMetrics: players.filter((player) => player.kind === 'bot').map((player) => botMetrics(
      completedViews.get(player.id)!, completed.audit!, player, latencies.get(player.id)!,
    )),
    caseInput, commands, cpuMicros: cpu.user + cpu.system, hash, iterations, peakRss, timeouts,
  })
}

const keyForPair = ({ case: caseInput }: MatchResult) => `${caseInput.seed}:${caseInput.composition.humans}+${caseInput.composition.bots}:${caseInput.permutation}`

const pairedHardEasy = (results: MatchResult[]) => {
  const byCase = new Map(results.map((result) => [`${keyForPair(result)}:${result.case.variant}`, result]))
  const bySeed = new Map<string, number[]>()
  for (const delta of results.filter((result) => result.case.variant === 'easy').flatMap((easy) => {
    const hard = byCase.get(`${keyForPair(easy)}:hard`)
    if (!hard) return []
    const botScore = (result: MatchResult) => mean(result.bots.map((bot) => bot.score))
    return [{ delta: botScore(hard) - botScore(easy), seed: easy.case.seed }]
  })) bySeed.set(delta.seed, [...(bySeed.get(delta.seed) ?? []), delta.delta])
  return { ...ci95([...bySeed.values()].map(mean)), clusters: bySeed.size }
}

const difficultySummary = (results: MatchResult[]) => Object.fromEntries((['easy', 'hard'] as const).map((difficulty) => {
  const bots = results.flatMap((result) => result.bots).filter((bot) => bot.difficulty === difficulty)
  const propertyCorrect = bots.reduce((total, bot) => total + bot.properties.correct, 0)
  const propertyInferred = bots.reduce((total, bot) => total + bot.properties.inferred, 0)
  const interactionCorrect = bots.reduce((total, bot) => total + bot.interactions.correct, 0)
  const interactionInferred = bots.reduce((total, bot) => total + bot.interactions.inferred, 0)
  const finalCorrect = bots.reduce((total, bot) => total + bot.final.correct, 0)
  const finalClaimed = bots.reduce((total, bot) => total + bot.final.claimed, 0)
  return [difficulty, {
    botRuns: bots.length,
    decisionLatencyMs: (() => {
      const pooled = bots.flatMap((bot) => bot.decisionLatenciesMs)
      return { max: Math.max(0, ...pooled), p50: percentile(pooled, 0.5), p95: percentile(pooled, 0.95) }
    })(),
    final: { accuracy: finalClaimed === 0 ? 0 : finalCorrect / finalClaimed, claimed: finalClaimed, correct: finalCorrect },
    interactions: { available: bots.length * 30, correct: interactionCorrect, coverage: bots.length === 0 ? 0 : interactionInferred / (bots.length * 30), inferred: interactionInferred, precision: interactionInferred === 0 ? 0 : interactionCorrect / interactionInferred },
    properties: { available: bots.length * 12, correct: propertyCorrect, coverage: bots.length === 0 ? 0 : propertyInferred / (bots.length * 12), inferred: propertyInferred, precision: propertyInferred === 0 ? 0 : propertyCorrect / propertyInferred },
    score: { mean: bots.length === 0 ? 0 : mean(bots.map((bot) => bot.score)) },
  }]
}))

const holdoutQualityGate = (results: MatchResult[], summaries: ReturnType<typeof difficultySummary>, paired: ReturnType<typeof pairedHardEasy>) => {
  const easy = summaries.easy
  const hard = summaries.hard
  const checks = {
    completionRate: results.length === expectedHoldoutCases && results.every((result) => result.iterations < maxSteps),
    consensusPrecision: easy.properties.precision >= approvedHoldoutThresholds.consensusPrecision
      && easy.interactions.precision >= approvedHoldoutThresholds.consensusPrecision
      && hard.properties.precision >= approvedHoldoutThresholds.consensusPrecision
      && hard.interactions.precision >= approvedHoldoutThresholds.consensusPrecision,
    easyPropertyCoverage: easy.properties.coverage >= approvedHoldoutThresholds.easyPropertyCoverage,
    hardMeanAdvantage: paired.mean !== null && paired.mean >= approvedHoldoutThresholds.hardMeanAdvantage,
    hardMeanAdvantageCiLower: paired.lower !== null && paired.lower > approvedHoldoutThresholds.hardMeanAdvantageCiLower,
    observedRssBytes: results.every((result) => result.peakRss <= approvedHoldoutThresholds.observedRssBytes),
    pooledDecisionP95Ms: easy.decisionLatencyMs.p95 <= approvedHoldoutThresholds.pooledDecisionP95Ms
      && hard.decisionLatencyMs.p95 <= approvedHoldoutThresholds.pooledDecisionP95Ms,
  }
  return { accepted: Object.values(checks).every(Boolean), checks, thresholds: approvedHoldoutThresholds }
}

const writeCombinedHoldoutReport = async (paths: string[]) => {
  if (paths.length === 0) throw new Error('Provide one or more shard report paths after --combine-holdout')
  const shards = await Promise.all(paths.map(async (path) => Bun.file(path).json() as Promise<{ results?: MatchResult[]; suite?: string }>))
  if (shards.some((shard) => shard.suite !== 'holdout' || !Array.isArray(shard.results))) {
    throw new Error('Every combined report must be a holdout shard with results')
  }
  const results = shards.flatMap((shard) => shard.results!)
  const seedSet = new Set(results.map((result) => result.case.seed))
  if (seedSet.size !== holdoutSeeds.length || holdoutSeeds.some((seed) => !seedSet.has(seed))) {
    throw new Error(`Combined holdout must contain each of the ${holdoutSeeds.length} frozen seeds exactly once`)
  }
  assertCompleteHoldoutMatrix(results.map((result) => result.case))
  const summaries = difficultySummary(results)
  const paired = pairedHardEasy(results)
  const qualityGate = holdoutQualityGate(results, summaries, paired)
  const report = {
    cases: results.length,
    commandCount: results.reduce((total, result) => total + result.commands, 0),
    determinism: 'every shard independently verified normalized command/score replay hashes before combination',
    difficultySummary: summaries,
    mode: 'holdout (combined frozen seed shards)',
    pairedHardMinusEasyBotScore: paired,
    qualityGate,
    environment: environment(),
    resources: {
      maxCpuMicros: Math.max(...results.map((result) => result.cpuMicros)),
      maxIterations: Math.max(...results.map((result) => result.iterations)),
      maxRss: Math.max(...results.map((result) => result.peakRss)),
      meanCpuMicros: mean(results.map((result) => result.cpuMicros)),
      timeouts: results.reduce((total, result) => total + result.timeouts, 0),
    },
    suite: 'holdout',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!qualityGate.accepted) process.exitCode = 1
}

async function main() {
  const combineFlag = process.argv.indexOf('--combine-holdout')
  if (combineFlag !== -1) return writeCombinedHoldoutReport(process.argv.slice(combineFlag + 1))
  const suiteFlag = process.argv.indexOf('--suite')
  const suite = (suiteFlag === -1 ? 'baseline' : process.argv[suiteFlag + 1]) as Suite
  if (suite !== 'baseline' && suite !== 'holdout') throw new Error('Use --suite baseline or --suite holdout')
  const smoke = process.argv.includes('--smoke')
  const allSuiteSeeds = suite === 'holdout' ? holdoutSeeds : baselineSeeds
  const seedIndexFlag = process.argv.indexOf('--seed-index')
  const seedIndex = seedIndexFlag === -1 ? undefined : Number(process.argv[seedIndexFlag + 1])
  if (seedIndex !== undefined && (!Number.isInteger(seedIndex) || seedIndex < 0 || seedIndex >= allSuiteSeeds.length)) {
    throw new Error(`--seed-index must select one available ${suite} seed`)
  }
  const suiteSeeds = seedIndex === undefined ? allSuiteSeeds : [allSuiteSeeds[seedIndex]!]
  const suiteCases = suiteSeeds.flatMap((seed) => compositions.flatMap((composition) => variants.flatMap((variant) =>
    Array.from({ length: composition.humans + composition.bots }, (_, permutation) => ({ composition, permutation, seed, variant })),
  )))
  const cases = smoke ? [
    { composition: compositions[0]!, permutation: 0, seed: suiteSeeds[0]!, variant: 'easy' as const },
    { composition: compositions[4]!, permutation: 1, seed: suiteSeeds[1] ?? suiteSeeds[0]!, variant: 'hard' as const },
  ] : suiteCases
  const results: MatchResult[] = []
  for (const caseInput of cases) {
    const first = await simulate(caseInput)
    const replay = await simulate(caseInput)
    if (first.hash !== replay.hash) throw new Error(`Non-deterministic normalized result for ${keyForPair(first)}:${caseInput.variant}`)
    results.push(first)
  }
  const summaries = difficultySummary(results)
  const paired = pairedHardEasy(results)
  const qualityGate = suite === 'holdout' && !smoke && seedIndex === undefined ? holdoutQualityGate(results, summaries, paired) : null
  const report = {
    cases: results.length,
    commandCount: results.reduce((total, result) => total + result.commands, 0),
    determinism: 'all normalized command/score hashes matched independent replays',
    difficultySummary: summaries,
    mode: smoke ? `smoke (two representative ${suite} cases; no quality claim)` : suite,
    pairedHardMinusEasyBotScore: paired,
    qualityGate,
    environment: environment(),
    results,
    suite,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (qualityGate && !qualityGate.accepted) process.exitCode = 1
}

if (import.meta.main) await main()
