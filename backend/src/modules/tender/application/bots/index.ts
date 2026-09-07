import type { FieldType, Polarity, SignalId, TenderCommand, TenderView } from '@anomaly-detector/contracts'

import { candidateConsensus, candidatesFromView, chooseLaboratoryObservation, type LaboratoryObservation } from './candidates'
import { signalIds } from '../../domain/anomaly-configuration'

export type BotDifficulty = 'easy' | 'hard'

export type ChooseBotCommandOptions = {
  commandId: string
  difficulty: BotDifficulty
  playerId: string
  seed: string
  strategyVersion?: 'bot-v1' | 'bot-v2'
}

const fieldTypes: FieldType[] = ['inertial', 'electromagnetic', 'phase']
const polarities: Polarity[] = ['positive', 'negative']

const seededValue = (seed: string) => {
  let value = 2_166_136_261
  for (const character of seed) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16_777_619)
  }
  return value >>> 0
}

const seededIndex = (seed: string, size: number) => seededValue(seed) % size

const stableOrder = <T>(items: T[], seed: string, key: (item: T) => string) => [...items].sort((left, right) => {
  const leftRank = seededValue(`${seed}:${key(left)}`)
  const rightRank = seededValue(`${seed}:${key(right)}`)
  return leftRank - rightRank || key(left).localeCompare(key(right))
})

const commandBase = (view: TenderView, options: ChooseBotCommandOptions) => ({
  actorId: options.playerId,
  commandId: options.commandId,
  tenderId: view.tenderId,
})

const isSequentialTurn = (view: TenderView, playerId: string) => view.activePlayerId === playerId

const allocationForRound = (view: TenderView) => {
  const samples = new Set(view.privateSamples).size
  const reconnaissance = Math.min(2, 6 - samples)
  if (view.round === 1) return { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2, reserve: 0 }
  if (view.round === 2) return { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance, reserve: 4 - reconnaissance - 2 }
  if (view.round === 3) {
    const laboratory = samples + reconnaissance >= 2 ? 2 : 0
    return { contracts: 0, laboratory, modelAnalysis: 0, reconnaissance, reserve: 4 - reconnaissance - laboratory }
  }
  if (view.round === 4) return { contracts: 1, laboratory: 0, modelAnalysis: 2, reconnaissance: 0, reserve: 1 }
  return { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 2 }
}

const thesisFor = (view: TenderView, options: ChooseBotCommandOptions, signalId: SignalId) => {
  const index = seededIndex(`${options.seed}:${view.round}:${signalId}`, fieldTypes.length * polarities.length)
  return {
    fieldType: fieldTypes[index % fieldTypes.length]!,
    polarity: polarities[Math.floor(index / fieldTypes.length)]!,
  }
}

/**
 * Produces one deterministic command from an already-authorised participant view.
 * It deliberately has no access to stored Tender state, anomaly configuration, or
 * the match seed; `options.seed` only gives stable bot tie choices.
 */
export const chooseBotV1Command = (view: TenderView, options: ChooseBotCommandOptions): TenderCommand | null => {
  const player = view.players.find((candidate) => candidate.playerId === options.playerId)
  if (!player || player.forfeited || view.hasForfeited || view.hasLeft || view.phase === 'complete') return null

  const base = commandBase(view, options)
  if (view.phase === 'access-slot-selection') {
    if (player.requestedAccessSlot !== undefined) return null
    return { ...base, slot: 6, type: 'request-access-slot' }
  }

  if (view.phase === 'power-allocation') {
    if (player.powerAllocationConfirmed) return null
    return { ...base, allocation: allocationForRound(view), type: 'allocate-power' }
  }

  if (view.phase === 'reconnaissance') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const count = player.powerAllocation?.reconnaissance ?? 0
    if (count === 0) return null
    const knownUncollected = stableOrder(
      view.knownSignals.filter((signal) => !view.privateSamples.includes(signal)),
      options.seed,
      (signal) => signal,
    ).slice(0, count)
    return {
      ...base,
      targets: [
        ...knownUncollected,
        ...Array.from({ length: count - knownUncollected.length }, () => 'unknown-sector' as const),
      ],
      type: 'conduct-reconnaissance',
    }
  }

  if (view.phase === 'laboratory') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const power = player.powerAllocation?.laboratory ?? 0
    if (power === 0) return null
    const samples = stableOrder([...new Set(view.privateSamples)], options.seed, (signal) => signal)
    const researched = new Set((view.publicScientificJournal ?? [])
      .filter((entry) => entry.playerId === options.playerId)
      .map((entry) => `${entry.sourceSignal}:${entry.receiverSignal}`))
    const pairs = samples.flatMap((sourceSignal) => samples
      .filter((receiverSignal) => receiverSignal !== sourceSignal)
      .map((receiverSignal) => ({ receiverSignal, sourceSignal }))
      .filter((pair) => !researched.has(`${pair.sourceSignal}:${pair.receiverSignal}`)))
    if (power === 1 && pairs[0]) {
      return { ...base, laboratory: { mode: 'impulse', pair: pairs[0] }, type: 'run-laboratory-test' }
    }
    if (power === 2 && pairs[0]) {
      return { ...base, laboratory: { mode: 'deep', pair: pairs[0] }, type: 'run-laboratory-test' }
    }
    return null
  }

  if (view.phase === 'model-analysis') {
    if (view.ruleset !== 'tender-v2' && !isSequentialTurn(view, options.playerId)) return null
    const maxTheses = player.powerAllocation?.modelAnalysis ?? 0
    const submitted = (view.privateTheses ?? []).filter((thesis) => thesis.round === view.round)
    if (player.modelAnalysisCompleted || submitted.length >= maxTheses) return null
    if (maxTheses >= 2 && submitted.length === 1 && view.corporateReviewActive && player.budget < 1) {
      return { ...base, type: 'finish-model-analysis' }
    }
    const candidates = stableOrder([...new Set(view.privateSamples)], options.seed, (signal) => signal)
      .filter((signal) => !submitted.some((thesis) => thesis.signalId === signal))
    const signalId = candidates[0]
    if (!signalId && maxTheses >= 2 && submitted.length === 1) return { ...base, type: 'finish-model-analysis' }
    if (!signalId) return null
    return { ...base, ...thesisFor(view, options, signalId), signalId, type: 'submit-thesis' }
  }

  if (view.phase === 'contracts') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const contracts = [...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]
    const reserved = contracts.find((contract) => contract.reservedByPlayerId === options.playerId && contract.bidOutcome === undefined)
    if (reserved?.planning) {
      const researchCertificationSignal = reserved.planning.suitableResearchCertificationSignals[0]
      const evidenceTestIds = reserved.planning.suitableEvidenceSelections[0]
      return {
        ...base,
        contractId: reserved.contractId,
        ...(evidenceTestIds ? { evidenceTestIds } : {}),
        ...(researchCertificationSignal ? { researchCertificationSignal } : {}),
        type: 'submit-contract-bid',
      }
    }
    const eligible = stableOrder(contracts.filter((contract) =>
      !contract.reservedByPlayerId && contract.bidOutcome === undefined && contract.planning?.eligible,
    ), options.seed, (contract) => contract.contractId)[0]
    if (eligible) return { ...base, contractId: eligible.contractId, type: 'reserve-contract' }
    return { ...base, type: 'skip-contract' }
  }

  if (view.phase === 'final-scientific-model') {
    if (view.ruleset !== 'tender-v2' && !isSequentialTurn(view, options.playerId)) return null
    if (player.finalScientificModelSubmitted || view.privateFinalScientificModelSubmission) return null
    const signals = Object.entries(view.privateWorkingModel.signals)
      .filter(([, claim]) => claim.hypothesis?.fieldType || claim.hypothesis?.polarity)
      .reduce<Record<string, { fieldType?: FieldType; polarity?: Polarity }>>((model, [signalId, claim]) => ({
        ...model,
        [signalId]: claim.hypothesis!,
      }), {})
    if (Object.keys(signals).length === 0) {
      const signalId = stableOrder([...new Set([...view.privateSamples, ...view.knownSignals])], options.seed, (signal) => signal)[0]
      if (!signalId) return null
      signals[signalId] = thesisFor(view, options, signalId)
    }
    return { ...base, scientificModel: { signals }, type: 'submit-scientific-model' }
  }

  return null
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const sameJson = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right)

const v2Allocation = (view: TenderView) => {
  const sampleCount = new Set(view.privateSamples).size
  const reconnaissance = Math.min(2, 6 - sampleCount)
  if (sampleCount < 6) return { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance, reserve: 2 - reconnaissance }
  if (view.round < 5) return { contracts: 0, laboratory: 2, modelAnalysis: 2, reconnaissance: 0, reserve: 0 }
  return { contracts: 1, laboratory: 0, modelAnalysis: 2, reconnaissance: 0, reserve: 1 }
}

const legalLaboratoryObservations = (view: TenderView, playerId: string, power: number): LaboratoryObservation[] => {
  const samples = [...new Set(view.privateSamples)].sort()
  const researched = new Set((view.publicScientificJournal ?? [])
    .filter((entry) => entry.playerId === playerId)
    .map((entry) => `${entry.sourceSignal}:${entry.receiverSignal}`))
  const pairs = samples.flatMap((sourceSignal) => samples
    .filter((receiverSignal) => receiverSignal !== sourceSignal)
    .map((receiverSignal) => ({ receiverSignal, sourceSignal }))
    .filter((pair) => !researched.has(`${pair.sourceSignal}:${pair.receiverSignal}`)))
  if (power === 1) return pairs.map((pair) => ({ mode: 'impulse' as const, pairs: [pair] }))
  if (power !== 2) return []
  return [
    ...pairs.map((pair) => ({ mode: 'deep' as const, pairs: [pair] })),
    ...pairs.flatMap((first, index) => pairs.slice(index + 1).map((second) => ({
      mode: 'broad' as const,
      pairs: [first, second],
    }))),
  ]
}

const consensusWorkingModel = (view: TenderView) => ({
  signals: Object.fromEntries(Object.entries(candidateConsensus(candidatesFromView(view)))
    .filter(([, claim]) => claim.fieldType || claim.polarity)
    .map(([signalId, claim]) => [signalId, { hypothesis: claim }])),
})

const chooseInformationThesis = (view: TenderView, options: ChooseBotCommandOptions, submitted: SignalId[]) => {
  const candidates = candidatesFromView(view)
  const choices = signalIds.flatMap((signalId) => fieldTypes.flatMap((fieldType) => polarities.map((polarity) => ({
    fieldType,
    polarity,
    signalId,
  })))).filter((choice) => !submitted.includes(choice.signalId))
  const score = (choice: typeof choices[number]) => {
    const outcomes = new Map<string, number>()
    for (const candidate of candidates) {
      const actual = candidate[choice.signalId]
      const key = `${actual.fieldType === choice.fieldType}:${actual.polarity === choice.polarity}`
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
    }
    return [...outcomes.values()].reduce((total, size) => {
      const probability = size / candidates.length
      return total - probability * Math.log2(probability)
    }, 0)
  }
  return [...choices].sort((left, right) => score(right) - score(left)
    || seededValue(`${options.seed}:${left.signalId}:${left.fieldType}:${left.polarity}`)
      - seededValue(`${options.seed}:${right.signalId}:${right.fieldType}:${right.polarity}`))[0]
}

const chooseBotV2Command = (view: TenderView, options: ChooseBotCommandOptions): TenderCommand | null => {
  const player = view.players.find((candidate) => candidate.playerId === options.playerId)
  if (!player || player.forfeited || view.hasForfeited || view.hasLeft || view.phase === 'complete') return null
  const base = commandBase(view, options)
  const candidates = candidatesFromView(view)

  if (view.phase === 'power-allocation' && !player.powerAllocationConfirmed) {
    return { ...base, allocation: v2Allocation(view), type: 'allocate-power' }
  }
  if (view.phase === 'laboratory' && isSequentialTurn(view, options.playerId)) {
    const observation = chooseLaboratoryObservation(candidates, legalLaboratoryObservations(
      view,
      options.playerId,
      player.powerAllocation?.laboratory ?? 0,
    ))
    if (observation?.mode === 'impulse') {
      return { ...base, laboratory: { mode: 'impulse', pair: observation.pairs[0]! }, type: 'run-laboratory-test' }
    }
    if (observation?.mode === 'deep') {
      return { ...base, laboratory: { mode: 'deep', pair: observation.pairs[0]! }, type: 'run-laboratory-test' }
    }
    if (observation?.mode === 'broad') {
      return { ...base, laboratory: { mode: 'broad', pairs: observation.pairs as [typeof observation.pairs[0], typeof observation.pairs[1]] }, type: 'run-laboratory-test' }
    }
  }
  if (view.phase === 'model-analysis'
    && !player.modelAnalysisCompleted
    && (view.ruleset === 'tender-v2' || isSequentialTurn(view, options.playerId))) {
    const submitted = (view.privateTheses ?? []).filter((thesis) => thesis.round === view.round)
    const maxTheses = player.powerAllocation?.modelAnalysis ?? 0
    if (maxTheses >= 2 && submitted.length === 1 && view.corporateReviewActive && player.budget < 1) {
      return { ...base, type: 'finish-model-analysis' }
    }
    const workingModel = consensusWorkingModel(view)
    if (!sameJson(view.privateWorkingModel, workingModel)) {
      return { ...base, type: 'update-working-model', workingModel }
    }
    const consensus = candidateConsensus(candidates)
    const signalId = Object.entries(consensus).find(([candidateId, claim]) =>
      (claim.fieldType || claim.polarity)
      && !submitted.some((thesis) => thesis.signalId === candidateId),
    )?.[0] as SignalId | undefined
    if (signalId && submitted.length < maxTheses && !player.modelAnalysisCompleted) {
      const claim = consensus[signalId]
      if (claim.fieldType && claim.polarity) {
        return { ...base, fieldType: claim.fieldType, polarity: claim.polarity, signalId, type: 'submit-thesis' }
      }
    }
    if (submitted.length < maxTheses && !player.modelAnalysisCompleted) {
      const thesis = chooseInformationThesis(view, options, submitted.map((thesis) => thesis.signalId))
      if (thesis) return { ...base, ...thesis, type: 'submit-thesis' }
    }
    return null
  }
  if (view.phase === 'final-scientific-model') {
    if (player.finalScientificModelSubmitted || view.privateFinalScientificModelSubmission) return null
    const signals = Object.fromEntries(Object.entries(candidateConsensus(candidates))
      .filter(([, claim]) => claim.fieldType || claim.polarity))
    if (Object.keys(signals).length > 0) return { ...base, scientificModel: { signals }, type: 'submit-scientific-model' }
    return null
  }
  return chooseBotV1Command(view, options)
}

export const chooseBotCommand = (view: TenderView, options: ChooseBotCommandOptions): TenderCommand | null =>
  options.strategyVersion === 'bot-v2'
    ? chooseBotV2Command(view, options)
    : chooseBotV1Command(view, options)
