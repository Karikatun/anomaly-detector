/** #74/#77 local simulation protocol. No database, network, or hidden state enters a policy. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { arch, cpus, platform } from 'node:os'
import { createTenderModule } from '../backend/src/modules/tender'
import { chooseBotCommand } from '../backend/src/modules/tender/application/bots'
import { candidateConsensus, candidatesFromView } from '../backend/src/modules/tender/application/bots/candidates'
import type { TenderCommand, TenderView } from '@anomaly-detector/contracts'
import { ci95 } from './bot-benchmark'

type Suite = 'pilot' | 'holdout' | 'reserve' | 'expanded'
type Composition = 'easy' | 'hard' | 'mixed' | 'control'
export type SimpleCase = { seed: string; players: 2 | 3 | 4; composition: Composition; rotation: number }
type AccessDiagnostic = { round: number; requestedSlot: number; assignedSlot: number; paidSlot: boolean;
  budgetBeforeAllocation: number; samplesBeforeAllocation: number; samplesAfterRecon: number }
type PlayerDiagnostics = { unavailablePaidSlotChoices: number; directPoolUnavailableAtRecon: number;
  secondThesisUnaffordable: number; laboratoryInsufficientSamples: number; laboratoryPairsExhausted: number;
  newDirectedPairs: number; repeatedDirectedPairs: number; directedPairCoverage: number;
  informationReducingLaboratoryActions: number; informationReducingTheses: number; accessByRound: AccessDiagnostic[] }
export const emptySimplePlayerDiagnostics = (): PlayerDiagnostics => ({ unavailablePaidSlotChoices: 0,
  directPoolUnavailableAtRecon: 0, secondThesisUnaffordable: 0, laboratoryInsufficientSamples: 0,
  laboratoryPairsExhausted: 0, newDirectedPairs: 0, repeatedDirectedPairs: 0, directedPairCoverage: 0,
  informationReducingLaboratoryActions: 0, informationReducingTheses: 0, accessByRound: [] })
type PlayerResult = PlayerDiagnostics & { actor: number; seat: number; score: number; budget: number; samples: number;
  candidates: number; provenProperties: number; wastedPower: number; laboratoryTests: number; won: boolean }
export type SimpleCaseResult = { input: SimpleCase; traceHash: string; hash: string; replayHash?: string; commands: number;
  timeouts: number; invalidCommands: number; maxDecisionMs: number; players: PlayerResult[];
  tieBreak: 'accuracy' | 'budget' | 'submission-order' }
const strategyVersion = 'bot-simple-v1' as const
const thresholds = Object.freeze({ researchDelta: 2, hardEasyDelta: 0, seatAccuracyGap: 1, winShareDiagnostic: 0.1 })
const seeds = (suite: Exclude<Suite, 'expanded'>) => Array.from({ length: suite === 'pilot' ? 12 : 8 }, (_, i) =>
  `simple-${suite}-20261102-${i}`)
const key = (input: SimpleCase) => `${input.seed}:${input.players}:${input.composition}:${input.rotation}`
const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
const stableJson = (value: unknown): string => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(',')}}` : JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')
export const simpleReplayFingerprint = (result: SimpleCaseResult) => hash({ input: result.input, traceHash: result.traceHash,
  commands: result.commands, timeouts: result.timeouts, invalidCommands: result.invalidCommands,
  players: result.players, tieBreak: result.tieBreak })
const normalizedView = (view: TenderView) => Object.fromEntries(Object.entries(view)
  .filter(([name]) => name !== 'serverTime' && name !== 'tenderId'))
const uniformIndex = (seed: string, size: number) => {
  const limit = Math.floor(0x1_0000_0000 / size) * size
  for (let attempt = 0; attempt < 32; attempt++) {
    const value = Number.parseInt(hash(`${seed}:${attempt}`).slice(0, 8), 16)
    if (value < limit) return value % size
  }
  throw new Error('Independent control choice exceeded rejection bound')
}

export const simpleMatrix = (suite: Suite): SimpleCase[] => {
  if (suite === 'expanded') return [...simpleMatrix('holdout'), ...simpleMatrix('reserve')]
  if (suite === 'pilot') return seeds('pilot').map((seed, index) => ({ seed, players: [2, 3, 4][index % 3] as 2 | 3 | 4,
    composition: ['easy', 'hard', 'mixed', 'control'][Math.floor(index / 3)] as Composition, rotation: index % [2, 3, 4][index % 3]! }))
  return seeds(suite).flatMap((seed) => ([2, 3, 4] as const).flatMap((players) =>
    (['easy', 'hard', 'mixed', 'control'] as const).flatMap((composition) =>
      Array.from({ length: players }, (_, rotation) => ({ seed, players, composition, rotation })))) )
}
export const assertSimpleMatrix = (actual: SimpleCase[], suite: Suite) => {
  const expected = new Set(simpleMatrix(suite).map(key))
  const keys = actual.map(key)
  if (keys.length !== new Set(keys).size || keys.length !== expected.size || keys.some((item) => !expected.has(item))) {
    throw new Error('Simple results do not match the complete frozen matrix')
  }
}

// Control uses the same legal permutation universe, with no research, result, world seed or configuration input.
const controlCommand = (view: TenderView, actorId: string, commandId: string, choiceSeed: string): TenderCommand | null => {
  const base = { actorId, commandId, tenderId: view.tenderId }
  const player = view.players.find((item) => item.playerId === actorId)!
  if (view.phase === 'access-slot-selection' && player.requestedAccessSlot === undefined) return { ...base, type: 'request-access-slot', slot: 4 }
  if (view.phase === 'power-allocation' && !player.powerAllocationConfirmed) return { ...base, type: 'allocate-power',
    allocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 0, contracts: 0, reserve: 4 } }
  if (view.phase === 'final-scientific-model' && !player.finalScientificModelSubmitted) {
    const universe = candidatesFromView({ privateMeasurements: [], privateTheses: [], publicScientificJournal: [] })
    const index = uniformIndex(choiceSeed, universe.length)
    return { ...base, type: 'submit-scientific-model', scientificModel: { signals: universe[index]! } }
  }
  return null
}

export async function simulateSimple(input: SimpleCase): Promise<SimpleCaseResult> {
  const tender = createTenderModule({ now: () => new Date('2026-11-02T12:00:00Z'), seedGenerator: (() => {
    let ordinal = 0
    return () => ordinal++ === 0 ? input.seed : `acquisition-${input.seed}`
  })() })
  const actors = Array.from({ length: input.players }, (_, seat) => ({ seat, actor: (seat + input.rotation) % input.players }))
  const difficulty = (actor: number) => input.composition === 'hard' || (input.composition === 'mixed' && actor === 0) ? 'hard' as const : 'easy' as const
  const { tenderId } = await tender.createTender({ mode: 'simple', players: actors.map(({ seat, actor }) => ({
    id: `actor-${actor}`, tiePriority: seat + 1,
    // One script-controlled authenticated participant represents the human seat. No browser acts for a persisted bot.
    ...(actor === 0 ? {} : { bot: { difficulty: difficulty(actor), strategyVersion } }),
  })) })
  // Retain only the digest in reports: frames contain the acting participant's private observations.
  const replayFrames: unknown[] = []
  const preFinal = new Map<number, TenderView>()
  const diagnostics = new Map(actors.map(({ actor }) => [actor, emptySimplePlayerDiagnostics()]))
  let maxDecisionMs = 0
  for (let step = 0; step < 200; step++) {
    const head = await tender.readTenderView({ playerId: 'actor-0', tenderId })
    if (head.phase === 'complete') {
      if (head.round !== head.game!.rounds || head.round !== 3 || !head.audit) throw new Error('Simple did not complete three rounds')
      const audit = head.audit
      const players = actors.map(({ actor, seat }): PlayerResult => {
        const id = `actor-${actor}`
        const final = preFinal.get(actor)!
        const candidates = candidatesFromView(final)
        const laboratory = audit.rounds.flatMap((round) => round.laboratory.filter((item) => item.playerId === id))
        const directedPairs = laboratory.flatMap((item) => item.tests.map((test) => `${test.sourceSignal}:${test.receiverSignal}`))
        const newDirectedPairs = new Set(directedPairs).size
        return { ...diagnostics.get(actor)!, newDirectedPairs, repeatedDirectedPairs: directedPairs.length - newDirectedPairs,
          directedPairCoverage: newDirectedPairs / 30,
          laboratoryInsufficientSamples: laboratory.filter((item) => item.skipReason === 'insufficient_samples').length,
          laboratoryPairsExhausted: laboratory.filter((item) => item.skipReason === 'all_pairs_researched').length,
          actor, seat, score: audit.ratingBreakdownByPlayer[id]!.total,
          budget: head.players.find((item) => item.playerId === id)!.budget,
          samples: final.privateSamples.length, candidates: candidates.length,
          provenProperties: Object.values(candidateConsensus(candidates)).reduce((total, claim) => total + Number(!!claim.fieldType) + Number(!!claim.polarity), 0),
          laboratoryTests: audit.rounds.reduce((total, round) => total + round.laboratory.filter((item) => item.playerId === id).reduce((sum, item) => sum + item.tests.length, 0), 0),
          wastedPower: audit.rounds.reduce((total, round) => {
            const allocation = round.powerAllocations.find((item) => item.playerId === id)!.allocation
            const thesisPower = round.theses.filter((item) => item.playerId === id).length
            return total + allocation.reserve + Math.max(0, allocation.modelAnalysis - thesisPower)
              + round.laboratory.filter((item) => item.playerId === id && item.resolution === 'skipped')
                .reduce((sum) => sum + allocation.laboratory, 0)
          }, 0), won: head.winnerPlayerIds?.includes(id) ?? false }
      })
      const sorted = [...players].sort((a, b) => audit.placementByPlayer[`actor-${a.actor}`]! - audit.placementByPlayer[`actor-${b.actor}`]!)
      const tieBreak = sorted[0]!.score !== sorted[1]!.score ? 'accuracy'
        : sorted[0]!.budget !== sorted[1]!.budget ? 'budget' : 'submission-order'
      const result: SimpleCaseResult = { input, commands: replayFrames.length, maxDecisionMs, timeouts: 0, invalidCommands: 0,
        traceHash: hash(replayFrames), hash: '', players, tieBreak }
      result.hash = simpleReplayFingerprint(result)
      return result
    }
    let moved = false
    for (const { actor } of actors) {
      const playerId = `actor-${actor}`
      const view = await tender.readTenderView({ playerId, tenderId })
      if (view.phase === 'final-scientific-model' && !preFinal.has(actor)) preFinal.set(actor, view)
      // Separate choice domain; identical for the target and opponents in all paired compositions.
      const choiceSeed = `simple-independent-choices-20261102:${actor}`
      const commandId = `simple-benchmark-${step}-${actor}`
      const start = performance.now()
      const command = input.composition === 'control' && actor === 0 ? controlCommand(view, playerId, commandId, choiceSeed)
        : chooseBotCommand(view, { playerId, commandId, seed: choiceSeed, difficulty: difficulty(actor), strategyVersion })
      maxDecisionMs = Math.max(maxDecisionMs, performance.now() - start)
      if (!command) continue
      const receipt = await tender.execute(command, { expectedVersion: view.version })
      const resultingView = await tender.readTenderView({ playerId, tenderId })
      const diagnostic = diagnostics.get(actor)!
      const self = view.players.find((item) => item.playerId === playerId)!
      if (command.type === 'request-access-slot') diagnostic.unavailablePaidSlotChoices += Number(self.budget < 2) + Number(self.budget < 1)
      if (command.type === 'allocate-power') diagnostic.accessByRound.push({ round: view.round,
        requestedSlot: self.requestedAccessSlot!, assignedSlot: self.accessSlot!, paidSlot: self.accessSlot! <= 2,
        budgetBeforeAllocation: self.budget, samplesBeforeAllocation: view.privateSamples.length,
        samplesAfterRecon: view.privateSamples.length })
      if (command.type === 'conduct-reconnaissance') {
        if (!(view.availableSamplePool ?? []).some((signal) => !view.privateSamples.includes(signal))) diagnostic.directPoolUnavailableAtRecon += 1
        const access = diagnostic.accessByRound.find((item) => item.round === view.round)!
        access.samplesAfterRecon = resultingView.privateSamples.length
      }
      if (command.type === 'run-laboratory-test' || command.type === 'submit-thesis') {
        const beforeCount = candidatesFromView(view).length, afterCount = candidatesFromView(resultingView).length
        if (afterCount < beforeCount) {
          if (command.type === 'run-laboratory-test') diagnostic.informationReducingLaboratoryActions += 1
          else diagnostic.informationReducingTheses += 1
        }
      }
      if (command.type === 'submit-thesis' && self.budget === 0 && self.powerAllocation?.modelAnalysis === 2
        && !(view.privateTheses ?? []).some((item) => item.round === view.round)
        && (resultingView.privateTheses ?? []).some((item) => item.round === view.round && !item.fullyCorrect)) diagnostic.secondThesisUnaffordable += 1
      replayFrames.push({
        command: Object.fromEntries(Object.entries(command).filter(([name]) => !['commandId', 'tenderId'].includes(name))),
        receipt: Object.fromEntries(Object.entries(receipt).filter(([name]) => name !== 'tenderId')),
        before: normalizedView(view), after: normalizedView(resultingView),
      })
      moved = true
      break
    }
    if (!moved) throw new Error(`No legal command without a timeout: ${key(input)} (${head.phase})`)
  }
  throw new Error(`Simple command bound exceeded: ${key(input)}`)
}

const evaluateCount = (results: SimpleCaseResult[], players: number) => {
  const selected = results.filter((item) => item.input.players === players)
  const blocks = [...new Set(selected.map((item) => item.input.seed))]
  const byCase = new Map(selected.map((item) => [key(item.input), item]))
  const delta = (comparison: 'control' | 'easy') => blocks.map((seed) => mean(selected
    .filter((item) => item.input.seed === seed && item.input.composition === 'mixed').map((mixed) => {
      const other = byCase.get(key({ ...mixed.input, composition: comparison }))!
      return mixed.players.find((item) => item.actor === 0)!.score - other.players.find((item) => item.actor === 0)!.score
    })))
  const seats = Object.fromEntries((['easy', 'hard'] as const).map((composition) => {
    const games = selected.filter((item) => item.input.composition === composition)
    const means = Array.from({ length: players }, (_, seat) => mean(games.flatMap((item) => item.players.filter((p) => p.seat === seat).map((p) => p.score))))
    const winShares = Array.from({ length: players }, (_, seat) => mean(games.map((item) => Number(item.players.find((p) => p.seat === seat)!.won))))
    return [composition, { means, gap: Math.max(...means) - Math.min(...means), winShares,
      winDiagnostic: winShares.some((share) => Math.abs(share - 1 / players) > thresholds.winShareDiagnostic) }]
  })) as Record<'easy' | 'hard', { means: number[]; gap: number; winShares: number[]; winDiagnostic: boolean }>
  const research = delta('control'), hardEasy = delta('easy')
  const gates = { research: mean(research) >= thresholds.researchDelta, difficulty: mean(hardEasy) >= thresholds.hardEasyDelta,
    seats: Object.values(seats).every((item) => item.gap <= thresholds.seatAccuracyGap) }
  const leaveOneSeedUnstable = blocks.length > 1 && blocks.some((seed) => {
    const reduced = selected.filter((item) => item.input.seed !== seed)
    const blockResearch = research.filter((_, i) => blocks[i] !== seed), blockHardEasy = hardEasy.filter((_, i) => blocks[i] !== seed)
    const reducedSeatPass = (['easy', 'hard'] as const).every((composition) => {
      const values = Array.from({ length: players }, (_, seat) => mean(reduced.filter((item) => item.input.composition === composition)
        .map((item) => item.players.find((p) => p.seat === seat)!.score)))
      return Math.max(...values) - Math.min(...values) <= thresholds.seatAccuracyGap
    })
    return (mean(blockResearch) >= thresholds.researchDelta) !== gates.research
      || (mean(blockHardEasy) >= thresholds.hardEasyDelta) !== gates.difficulty || reducedSeatPass !== gates.seats
  })
  return { seedBlocks: blocks.length, researchDelta: { ...ci95(research), blocks: research }, hardEasyDelta: { ...ci95(hardEasy), blocks: hardEasy },
    seats, gates, leaveOneSeedUnstable, expansionRequired: leaveOneSeedUnstable || Object.values(seats).some((item) => item.winDiagnostic) }
}
export const summarizeSimple = (results: SimpleCaseResult[], suite: Exclude<Suite, 'pilot'>) => {
  assertSimpleMatrix(results.map((item) => item.input), suite)
  const byPlayers = Object.fromEntries([2, 3, 4].map((players) => [players, evaluateCount(results, players)])) as Record<number, ReturnType<typeof evaluateCount>>
  const gates = { completionAndLegality: results.every((item) => item.timeouts === 0 && item.invalidCommands === 0 && item.commands > 0),
    replay: results.every((item) => item.hash === item.replayHash && item.hash === simpleReplayFingerprint(item)), ...Object.fromEntries(Object.entries(byPlayers).flatMap(([count, item]) =>
      Object.entries(item.gates).map(([name, pass]) => [`${name}-${count}`, pass]))) }
  const expansionRequired = Object.values(byPlayers).some((item) => item.expansionRequired)
  const numericAccepted = Object.values(gates).every(Boolean)
  const status = !numericAccepted ? 'FAIL' : !expansionRequired ? 'PASS' : suite === 'expanded' ? 'NEEDS_ANALYSIS' : 'NEEDS_EXPANSION'
  return { byPlayers, gates, thresholds, expansionRequired,
    numericAccepted, status, accepted: status === 'PASS',
    diagnosticUnresolved: suite === 'expanded' && expansionRequired,
    tieBreaks: Object.fromEntries(['accuracy', 'budget', 'submission-order'].map((kind) => [kind, results.filter((item) => item.tieBreak === kind).length])) }
}

async function sourceIdentity() {
  const paths = ['scripts/simple-bot-benchmark.ts', 'scripts/bot-benchmark.ts']
  for (const pattern of ['backend/src/modules/tender/**/*.ts', 'packages/contracts/src/*.ts']) {
    for await (const path of new Bun.Glob(pattern).scan('.')) if (!path.includes('.test.') && !path.includes('/fixtures/')) paths.push(path)
  }
  const files = await Promise.all(paths.sort().map(async (path) => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })))
  return { files, sha256: hash(files) }
}
export async function runSimpleBenchmark() {
  const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
  const manifestPath = value('--manifest')
  const suite = (value('--suite') ?? 'pilot') as Suite
  if (!['pilot', 'holdout', 'reserve', 'expanded'].includes(suite)) throw new Error('Simple suite: pilot, holdout, reserve, expanded')
  const source = await sourceIdentity()
  if (process.argv.includes('--freeze')) {
    if (!manifestPath || !value('--pilot-report')) throw new Error('Freeze needs --manifest and --pilot-report')
    if (await Bun.file(manifestPath).exists()) throw new Error('Refusing to overwrite a frozen manifest')
    const pilot = await Bun.file(value('--pilot-report')!).json()
    assertSimpleMatrix(pilot.results.map((item: SimpleCaseResult) => item.input), 'pilot')
    if (pilot.source.sha256 !== source.sha256 || pilot.results.some((item: SimpleCaseResult) => item.hash !== item.replayHash || item.timeouts || item.invalidCommands)) throw new Error('Pilot must pass replay/legality on the exact frozen source')
    const manifest = { protocol: '#74 2026-11-02', mode: 'simple', strategyVersion, rules: { rounds: 3, power: 4, maxScore: 12 },
      permittedInputs: 'own live participant projection; independent actor choice seed; no hidden state or world seed',
      thresholds, matrix: simpleMatrix('holdout'), reserve: simpleMatrix('reserve'), source,
      expansion: 'add all eight reserved seed blocks on win-share diagnostic or leave-one-seed verdict instability',
      pilotReportHash: hash(pilot), createdAt: new Date().toISOString() }
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))
    process.stdout.write(`${JSON.stringify({ frozen: true, manifestHash: hash(manifest), sourceHash: source.sha256 })}\n`)
    return
  }
  let manifestHash: string | undefined
  if (suite !== 'pilot') {
    if (!manifestPath) throw new Error('Holdout requires a pre-existing frozen --manifest')
    const manifest = await Bun.file(manifestPath).json()
    if (manifest.source.sha256 !== source.sha256 || stableJson(manifest.matrix) !== stableJson(simpleMatrix('holdout'))
      || stableJson(manifest.thresholds) !== stableJson(thresholds) || stableJson(manifest.reserve) !== stableJson(simpleMatrix('reserve'))) throw new Error('Frozen protocol/source changed')
    manifestHash = hash(manifest)
  }
  const combineAt = process.argv.indexOf('--combine')
  const results: SimpleCaseResult[] = []
  if (combineAt >= 0) {
    for (const path of process.argv.slice(combineAt + 1)) {
      const report = await Bun.file(path).json()
      if (report.manifestHash !== manifestHash) throw new Error('Combined reports use different frozen manifests')
      results.push(...report.results)
    }
  } else {
    const matrix = simpleMatrix(suite)
    const cases = process.argv.includes('--smoke') ? matrix.slice(0, 2) : matrix
    for (const input of cases) {
      const first = await simulateSimple(input), replay = await simulateSimple(input)
      first.replayHash = replay.hash
      if (first.hash !== first.replayHash) throw new Error(`Replay differs: ${key(input)}`)
      results.push(first)
      process.stderr.write(`simple ${suite}: ${results.length}/${cases.length}\n`)
    }
  }
  const summary = suite !== 'pilot' && !process.argv.includes('--smoke') ? summarizeSimple(results, suite) : null
  process.stdout.write(`${JSON.stringify({ mode: 'simple', suite, source, manifestHash, results, summary,
    environment: { bun: Bun.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    independentSample: 'seed blocks only; replay and rotations are dependent', humanUnderstanding: 'NOT RUN' }, null, 2)}\n`)
  if (summary && !summary.accepted) process.exitCode = 1
}
if (import.meta.main) await runSimpleBenchmark()
