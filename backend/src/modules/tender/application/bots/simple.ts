import type { FieldType, Polarity, SignalId, TenderCommand, TenderView } from '@anomaly-detector/contracts'
import { candidatesFromView, chooseLaboratoryObservation, type CandidateConfiguration, type LaboratoryObservation } from './candidates'
import { signalIds } from '../../domain/anomaly-configuration'

const fields: FieldType[] = ['inertial', 'electromagnetic', 'phase']
type SimpleBotOptions = { commandId: string; difficulty: 'easy' | 'hard'; playerId: string; seed: string }
const polarities: Polarity[] = ['positive', 'negative']
const rank = (seed: string) => {
  let value = 2_166_136_261
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16_777_619)
  return value >>> 0
}
const ordered = <T>(items: T[], seed: string) => [...items].sort((a, b) =>
  rank(`${seed}:${JSON.stringify(a)}`) - rank(`${seed}:${JSON.stringify(b)}`)
  || JSON.stringify(a).localeCompare(JSON.stringify(b)))

const observations = (view: TenderView, power: number): LaboratoryObservation[] => {
  const samples = [...new Set(view.privateSamples)]
  const used = new Set((view.publicScientificJournal ?? []).map((entry) => `${entry.sourceSignal}:${entry.receiverSignal}`))
  const pairs = samples.flatMap((sourceSignal) => samples.filter((receiverSignal) => receiverSignal !== sourceSignal)
    .map((receiverSignal) => ({ sourceSignal, receiverSignal })))
    .filter((pair) => !used.has(`${pair.sourceSignal}:${pair.receiverSignal}`))
  if (power === 1) return pairs.map((pair) => ({ mode: 'impulse', pairs: [pair] }))
  if (power !== 2) return []
  return [...pairs.map((pair): LaboratoryObservation => ({ mode: 'deep', pairs: [pair] })),
    ...pairs.flatMap((first, index) => pairs.slice(index + 1).map((second): LaboratoryObservation => ({ mode: 'broad', pairs: [first, second] })))]
}

const informationThesis = (candidates: CandidateConfiguration[], excluded: SignalId[], seed: string) => {
  const choices = ordered(signalIds.flatMap((signalId) => fields.flatMap((fieldType) => polarities.map((polarity) => ({
    signalId, fieldType, polarity,
  })))).filter((choice) => !excluded.includes(choice.signalId)), seed)
  const entropy = (choice: typeof choices[number]) => {
    const counts = [0, 0, 0, 0]
    for (const candidate of candidates) {
      const actual = candidate[choice.signalId]
      counts[Number(actual.fieldType === choice.fieldType) * 2 + Number(actual.polarity === choice.polarity)]! += 1
    }
    return counts.reduce((total, count) => count === 0 ? total : total - count / candidates.length * Math.log2(count / candidates.length), 0)
  }
  return choices.map((choice) => ({ choice, entropy: entropy(choice) }))
    .sort((a, b) => b.entropy - a.entropy)[0]?.choice
}

const finalModel = (candidates: CandidateConfiguration[], options: SimpleBotOptions) => {
  const orderedCandidates = ordered(candidates, options.seed)
  if (options.difficulty === 'easy') return orderedCandidates[0]
  const frequencies = new Map<string, number>()
  for (const candidate of candidates) for (const signal of signalIds) for (const key of ['fieldType', 'polarity'] as const) {
    const token = `${signal}:${key}:${candidate[signal][key]}`
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  }
  const score = (candidate: CandidateConfiguration) => signalIds.reduce((total, signal) => total
    + (frequencies.get(`${signal}:fieldType:${candidate[signal].fieldType}`) ?? 0)
    + (frequencies.get(`${signal}:polarity:${candidate[signal].polarity}`) ?? 0), 0)
  return orderedCandidates.sort((a, b) => score(b) - score(a))[0]
}

/** Versioned 3×4 policy. Input is only the actor's live projection and independent choice seed. */
export const chooseSimpleBotCommand = (view: TenderView, options: SimpleBotOptions): TenderCommand | null => {
  if (view.game?.mode !== 'simple') return null
  const player = view.players.find((item) => item.playerId === options.playerId)
  if (!player || player.forfeited || view.hasForfeited || view.hasLeft || view.phase === 'complete') return null
  const base = { actorId: options.playerId, commandId: options.commandId, tenderId: view.tenderId }
  if (view.phase === 'access-slot-selection') return player.requestedAccessSlot === undefined
    ? { ...base, type: 'request-access-slot', slot: 6 } : null
  if (view.phase === 'power-allocation') {
    if (player.powerAllocationConfirmed) return null
    const reconnaissance = Math.min(2, 6 - new Set(view.privateSamples).size)
    const laboratory = reconnaissance === 0 ? 2 : 1
    const modelAnalysis = Math.min(2, 4 - reconnaissance - laboratory)
    return { ...base, type: 'allocate-power', allocation: { contracts: 0, reconnaissance, laboratory,
      modelAnalysis, reserve: 4 - reconnaissance - laboratory - modelAnalysis } }
  }
  if (view.phase === 'reconnaissance' && view.activePlayerId === options.playerId) {
    const count = player.powerAllocation?.reconnaissance ?? 0
    if (count === 0) return null
    const available = (view.availableSamplePool ?? []).filter((signal) => !view.privateSamples.includes(signal))
    const targets = ordered(available, options.seed).slice(0, count)
    return { ...base, type: 'conduct-reconnaissance', targets: [...targets,
      ...Array.from({ length: count - targets.length }, () => 'unknown-sector' as const)] }
  }
  const candidates = candidatesFromView(view)
  if (view.phase === 'laboratory' && view.activePlayerId === options.playerId) {
    const choices = observations(view, player.powerAllocation?.laboratory ?? 0)
    const observation = chooseLaboratoryObservation(candidates, ordered(choices, options.seed))
    if (!observation) return null
    return { ...base, type: 'run-laboratory-test', laboratory: observation.mode === 'broad'
      ? { mode: 'broad', pairs: observation.pairs as [typeof observation.pairs[0], typeof observation.pairs[1]] }
      : { mode: observation.mode, pair: observation.pairs[0]! } }
  }
  if (view.phase === 'model-analysis' && !player.modelAnalysisCompleted) {
    const submitted = (view.privateTheses ?? []).filter((thesis) => thesis.round === view.round)
    if (submitted.length >= (player.powerAllocation?.modelAnalysis ?? 0)) return null
    if (submitted.length === 1 && view.corporateReviewActive && player.budget < 1) return { ...base, type: 'finish-model-analysis' }
    const thesis = informationThesis(candidates, submitted.map((item) => item.signalId), options.seed)
    return thesis ? { ...base, type: 'submit-thesis', ...thesis } : null
  }
  if (view.phase === 'final-scientific-model' && !player.finalScientificModelSubmitted && !view.privateFinalScientificModelSubmission) {
    const signals = finalModel(candidates, options)
    return signals ? { ...base, type: 'submit-scientific-model', scientificModel: { signals } } : null
  }
  return null
}
