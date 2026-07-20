/**
 * PROTOTYPE: pure round logic for manually exploring the match state machine.
 * It is deliberately small and has no persistence, transport, or production validation.
 */

export const phaseNames = ["reconnaissance", "laboratory", "model-analysis", "contracts"] as const;

export type PhaseName = (typeof phaseNames)[number];
export type PowerAllocation = Record<PhaseName, number>;
export type PlayerId = "A" | "B" | "C" | "D";

export type PlayerState = {
  id: PlayerId;
  tiePriority: number;
  requestedSlot?: number;
  accessSlot?: number;
  power?: PowerAllocation;
};

export type PrototypeState = {
  phase: "slot-selection" | "power-allocation" | PhaseName | "complete";
  round: number;
  players: PlayerState[];
  pendingPlayers: PlayerId[];
  log: string[];
};

export type PrototypeAction =
  | { type: "request-slot"; playerId: PlayerId; slot: number }
  | { type: "resolve-slots" }
  | { type: "allocate-power"; playerId: PlayerId; power: PowerAllocation }
  | { type: "start-operations" }
  | { type: "perform-action"; target: string }
  | { type: "next-phase" };

const emptyPower = (): PowerAllocation => ({
  reconnaissance: 0,
  laboratory: 0,
  "model-analysis": 0,
  contracts: 0,
});

export const createPrototypeState = (teamCount: number = 4): PrototypeState => {
  const ids = ["A", "B", "C", "D"] as const;

  return {
    phase: "slot-selection",
    round: 1,
    players: ids.slice(0, teamCount).map((id, index) => ({ id, tiePriority: index + 1 })),
    pendingPlayers: [],
    log: ["Round 1 started. Players may request Access Slots 1-6."],
  };
};

const teamById = (state: PrototypeState, playerId: PlayerId): PlayerState => {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);
  return player;
};

const orderedByAccess = (state: PrototypeState, reverse = false): PlayerState[] =>
  [...state.players].sort((left, right) => {
    const order = (left.accessSlot ?? 99) - (right.accessSlot ?? 99);
    return reverse ? -order : order;
  });

const phaseQueue = (state: PrototypeState, phase: PhaseName): PlayerId[] =>
  orderedByAccess(state)
    .filter((player) => (player.power?.[phase] ?? 0) > 0)
    .map((player) => player.id);

const assertPower = (power: PowerAllocation) => {
  const values = Object.values(power);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 2)) {
    throw new Error("Each Power category must be an integer from 0 to 2.");
  }
  if (values.reduce((sum, value) => sum + value, 0) !== 4) {
    throw new Error("A player must allocate exactly 4 Power.");
  }
};

export const reducePrototypeState = (state: PrototypeState, action: PrototypeAction): PrototypeState => {
  const next: PrototypeState = structuredClone(state);

  if (action.type === "request-slot") {
    if (next.phase !== "slot-selection") throw new Error("Access Slots are no longer accepting requests.");
    if (action.slot < 1 || action.slot > 6) throw new Error("Access Slot must be between 1 and 6.");
    teamById(next, action.playerId).requestedSlot = action.slot;
    next.log.push(`Player ${action.playerId} requested slot ${action.slot}.`);
    return next;
  }

  if (action.type === "resolve-slots") {
    if (next.phase !== "slot-selection") throw new Error("Slots can only be resolved during slot selection.");
    if (next.players.some((player) => player.requestedSlot === undefined)) {
      throw new Error("Every player must request an Access Slot first.");
    }

    const occupied = new Set<number>();
    const displaced: PlayerState[] = [];
    const requests = [...next.players].sort(
      (left, right) => left.requestedSlot! - right.requestedSlot! || left.tiePriority - right.tiePriority,
    );

    for (const player of requests) {
      const requested = player.requestedSlot!;
      if (occupied.has(requested)) {
        displaced.push(player);
        continue;
      }
      player.accessSlot = requested;
      occupied.add(requested);
      next.log.push(`Player ${player.id} received slot ${requested}.`);
    }

    for (const player of displaced) {
      let assigned = player.requestedSlot! + 1;
      while (occupied.has(assigned)) assigned += 1;
      if (assigned > 6) throw new Error("No later Access Slot is available.");
      player.accessSlot = assigned;
      occupied.add(assigned);
      next.log.push(`Player ${player.id} was displaced to slot ${assigned}.`);
    }

    next.phase = "power-allocation";
    next.pendingPlayers = orderedByAccess(next, true).map((player) => player.id);
    next.log.push(`Power planning begins in reverse slot order: ${next.pendingPlayers.join(", ")}.`);
    return next;
  }

  if (action.type === "allocate-power") {
    if (next.phase !== "power-allocation") throw new Error("Power can only be allocated during power planning.");
    if (next.pendingPlayers[0] !== action.playerId) throw new Error(`Player ${next.pendingPlayers[0]} plans next.`);
    assertPower(action.power);
    teamById(next, action.playerId).power = action.power;
    next.pendingPlayers.shift();
    next.log.push(`Player ${action.playerId} allocated Power.`);
    return next;
  }

  if (action.type === "start-operations") {
    if (next.phase !== "power-allocation") throw new Error("Operations start after power planning.");
    if (next.pendingPlayers.length > 0) throw new Error("Every player must allocate Power first.");
    next.phase = "reconnaissance";
    next.pendingPlayers = phaseQueue(next, next.phase);
    next.log.push(`Reconnaissance begins: ${next.pendingPlayers.join(", ") || "no actions"}.`);
    return next;
  }

  if (action.type === "perform-action") {
    if (!phaseNames.includes(next.phase as PhaseName)) throw new Error("There is no active operational phase.");
    const playerId = next.pendingPlayers[0];
    if (!playerId) throw new Error("No player has an action remaining in this phase.");
    next.pendingPlayers.shift();
    next.log.push(`Player ${playerId} performed ${next.phase}: ${action.target}.`);
    return next;
  }

  if (action.type === "next-phase") {
    if (!phaseNames.includes(next.phase as PhaseName)) throw new Error("There is no operational phase to advance.");
    if (next.pendingPlayers.length > 0) throw new Error("Resolve every action before advancing the phase.");
    const index = phaseNames.indexOf(next.phase as PhaseName);
    const following = phaseNames[index + 1];
    if (!following) {
      next.phase = "complete";
      next.log.push("Round complete. Review the event log before starting another round.");
      return next;
    }
    next.phase = following;
    next.pendingPlayers = phaseQueue(next, following);
    next.log.push(`${following} begins: ${next.pendingPlayers.join(", ") || "no actions"}.`);
    return next;
  }

  return next;
};

export const exampleAllocation = (): PowerAllocation => ({
  ...emptyPower(),
  reconnaissance: 1,
  laboratory: 2,
  contracts: 1,
});
