/** PROTOTYPE TUI - delete after the round state machine is validated. */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
// @ts-ignore Node type stripping requires an explicit TypeScript extension in this prototype.
import { createPrototypeState, exampleAllocation, reducePrototypeState, type PowerAllocation, type PrototypeState, type PlayerId } from "./round-machine.ts";

let state: PrototypeState = createPrototypeState(4);

const render = () => {
  console.clear();
  console.log("\x1b[1mAnomaly Detector: Round State Prototype\x1b[0m");
  console.log("\x1b[2mQuestion: are slot conflicts, planning order, and phase actions clear?\x1b[0m\n");
  console.log(`\x1b[1mRound\x1b[0m ${state.round}`);
  console.log(`\x1b[1mPhase\x1b[0m ${state.phase}`);
  console.log(`\x1b[1mPending players\x1b[0m ${state.pendingPlayers.join(", ") || "none"}\n`);
  console.log("\x1b[1mPlayers\x1b[0m");
  console.table(
    state.players.map((player) => ({
      player: player.id,
      tiePriority: player.tiePriority,
      requestedSlot: player.requestedSlot ?? "-",
      accessSlot: player.accessSlot ?? "-",
      power: player.power ? JSON.stringify(player.power) : "-",
    })),
  );
  console.log("\x1b[1mEvent log\x1b[0m");
  for (const entry of state.log.slice(-8)) console.log(`- ${entry}`);
  console.log("\n\x1b[1mCommands\x1b[0m");
  console.log("slot <A-D> <1-6> | resolve | power <A-D> <r> <l> <m> <c> | start");
  console.log("act <target> | next | demo | reset <2-4> | q");
};

const parsePower = (values: string[]): PowerAllocation => ({
  reconnaissance: Number(values[0]),
  laboratory: Number(values[1]),
  "model-analysis": Number(values[2]),
  contracts: Number(values[3]),
});

const demo = () => {
  state = createPrototypeState(4);
  for (const [player, slot] of [
    ["A", 1],
    ["B", 1],
    ["C", 2],
    ["D", 6],
  ] as const) {
    state = reducePrototypeState(state, { type: "request-slot", playerId: player, slot });
  }
  state = reducePrototypeState(state, { type: "resolve-slots" });
  for (const player of [...state.pendingPlayers]) {
    state = reducePrototypeState(state, { type: "allocate-power", playerId: player, power: exampleAllocation() });
  }
  state = reducePrototypeState(state, { type: "start-operations" });
};

const execute = (line: string): boolean => {
  const [command, ...args] = line.trim().split(/\s+/);
  if (!command) return true;
  if (command === "q" || command === "quit") return false;
  if (command === "reset") {
    state = createPrototypeState(Number(args[0] ?? 4));
    return true;
  }
  if (command === "demo") {
    demo();
    return true;
  }
  if (command === "slot") {
    state = reducePrototypeState(state, { type: "request-slot", playerId: args[0] as PlayerId, slot: Number(args[1]) });
    return true;
  }
  if (command === "resolve") {
    state = reducePrototypeState(state, { type: "resolve-slots" });
    return true;
  }
  if (command === "power") {
    state = reducePrototypeState(state, { type: "allocate-power", playerId: args[0] as PlayerId, power: parsePower(args.slice(1)) });
    return true;
  }
  if (command === "start") {
    state = reducePrototypeState(state, { type: "start-operations" });
    return true;
  }
  if (command === "act") {
    state = reducePrototypeState(state, { type: "perform-action", target: args.join(" ") || "unnamed target" });
    return true;
  }
  if (command === "next") {
    state = reducePrototypeState(state, { type: "next-phase" });
    return true;
  }
  throw new Error(`Unknown command: ${command}`);
};

const run = async () => {
  const terminal = createInterface({ input, output });
  let active = true;
  while (active) {
    render();
    const line = await terminal.question("\n> ");
    try {
      active = execute(line);
    } catch (error) {
      state.log.push(`Rejected: ${(error as Error).message}`);
    }
  }
  terminal.close();
};

await run();
