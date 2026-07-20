/**
 * PROTOTYPE: pure round logic for manually exploring the match state machine.
 * It is deliberately small and has no persistence, transport, or production validation.
 */

export const phaseNames = ["reconnaissance", "laboratory", "model-analysis", "contracts"] as const;

export type PhaseName = (typeof phaseNames)[number];
export type PowerAllocation = Record<PhaseName, number>;
export type TeamId = "A" | "B" | "C" | "D";

export type TeamState = {
  id: TeamId;
  tiePriority: number;
  requestedSlot?: number;
  accessSlot?: number;
  power?: PowerAllocation;
};

export type PrototypeState = {
  phase: "slot-selection" | "power-allocation" | PhaseName | "complete";
  round: number;
  teams: TeamState[];
  pendingTeams: TeamId[];
  log: string[];
};

export type PrototypeAction =
  | { type: "request-slot"; teamId: TeamId; slot: number }
  | { type: "resolve-slots" }
  | { type: "allocate-power"; teamId: TeamId; power: PowerAllocation }
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
    teams: ids.slice(0, teamCount).map((id, index) => ({ id, tiePriority: index + 1 })),
    pendingTeams: [],
    log: ["Round 1 started. Teams may request Access Slots 1-6."],
  };
};

const teamById = (state: PrototypeState, teamId: TeamId): TeamState => {
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Unknown team ${teamId}`);
  return team;
};

const orderedByAccess = (state: PrototypeState, reverse = false): TeamState[] =>
  [...state.teams].sort((left, right) => {
    const order = (left.accessSlot ?? 99) - (right.accessSlot ?? 99);
    return reverse ? -order : order;
  });

const phaseQueue = (state: PrototypeState, phase: PhaseName): TeamId[] =>
  orderedByAccess(state)
    .filter((team) => (team.power?.[phase] ?? 0) > 0)
    .map((team) => team.id);

const assertPower = (power: PowerAllocation) => {
  const values = Object.values(power);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 2)) {
    throw new Error("Each Power category must be an integer from 0 to 2.");
  }
  if (values.reduce((sum, value) => sum + value, 0) !== 4) {
    throw new Error("A team must allocate exactly 4 Power.");
  }
};

export const reducePrototypeState = (state: PrototypeState, action: PrototypeAction): PrototypeState => {
  const next: PrototypeState = structuredClone(state);

  if (action.type === "request-slot") {
    if (next.phase !== "slot-selection") throw new Error("Access Slots are no longer accepting requests.");
    if (action.slot < 1 || action.slot > 6) throw new Error("Access Slot must be between 1 and 6.");
    teamById(next, action.teamId).requestedSlot = action.slot;
    next.log.push(`Team ${action.teamId} requested slot ${action.slot}.`);
    return next;
  }

  if (action.type === "resolve-slots") {
    if (next.phase !== "slot-selection") throw new Error("Slots can only be resolved during slot selection.");
    if (next.teams.some((team) => team.requestedSlot === undefined)) {
      throw new Error("Every team must request an Access Slot first.");
    }

    const occupied = new Set<number>();
    const displaced: TeamState[] = [];
    const requests = [...next.teams].sort(
      (left, right) => left.requestedSlot! - right.requestedSlot! || left.tiePriority - right.tiePriority,
    );

    for (const team of requests) {
      const requested = team.requestedSlot!;
      if (occupied.has(requested)) {
        displaced.push(team);
        continue;
      }
      team.accessSlot = requested;
      occupied.add(requested);
      next.log.push(`Team ${team.id} received slot ${requested}.`);
    }

    for (const team of displaced) {
      let assigned = team.requestedSlot! + 1;
      while (occupied.has(assigned)) assigned += 1;
      if (assigned > 6) throw new Error("No later Access Slot is available.");
      team.accessSlot = assigned;
      occupied.add(assigned);
      next.log.push(`Team ${team.id} was displaced to slot ${assigned}.`);
    }

    next.phase = "power-allocation";
    next.pendingTeams = orderedByAccess(next, true).map((team) => team.id);
    next.log.push(`Power planning begins in reverse slot order: ${next.pendingTeams.join(", ")}.`);
    return next;
  }

  if (action.type === "allocate-power") {
    if (next.phase !== "power-allocation") throw new Error("Power can only be allocated during power planning.");
    if (next.pendingTeams[0] !== action.teamId) throw new Error(`Team ${next.pendingTeams[0]} plans next.`);
    assertPower(action.power);
    teamById(next, action.teamId).power = action.power;
    next.pendingTeams.shift();
    next.log.push(`Team ${action.teamId} allocated Power.`);
    return next;
  }

  if (action.type === "start-operations") {
    if (next.phase !== "power-allocation") throw new Error("Operations start after power planning.");
    if (next.pendingTeams.length > 0) throw new Error("Every team must allocate Power first.");
    next.phase = "reconnaissance";
    next.pendingTeams = phaseQueue(next, next.phase);
    next.log.push(`Reconnaissance begins: ${next.pendingTeams.join(", ") || "no actions"}.`);
    return next;
  }

  if (action.type === "perform-action") {
    if (!phaseNames.includes(next.phase as PhaseName)) throw new Error("There is no active operational phase.");
    const teamId = next.pendingTeams[0];
    if (!teamId) throw new Error("No team has an action remaining in this phase.");
    next.pendingTeams.shift();
    next.log.push(`Team ${teamId} performed ${next.phase}: ${action.target}.`);
    return next;
  }

  if (action.type === "next-phase") {
    if (!phaseNames.includes(next.phase as PhaseName)) throw new Error("There is no operational phase to advance.");
    if (next.pendingTeams.length > 0) throw new Error("Resolve every action before advancing the phase.");
    const index = phaseNames.indexOf(next.phase as PhaseName);
    const following = phaseNames[index + 1];
    if (!following) {
      next.phase = "complete";
      next.log.push("Round complete. Review the event log before starting another round.");
      return next;
    }
    next.phase = following;
    next.pendingTeams = phaseQueue(next, following);
    next.log.push(`${following} begins: ${next.pendingTeams.join(", ") || "no actions"}.`);
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
