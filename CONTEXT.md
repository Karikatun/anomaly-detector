# Anomaly Detector

The shared language for the competitive research game in `docs/GAME_DESIGN_BRIEF.md`. Use these terms consistently in game rules, API contracts, tests, and player-facing copy.

## Anomaly Research

**Anomaly Configuration**:
The hidden, seed-derived assignment of properties and directed interactions for one match. It is known only to the authoritative server until the post-match audit.
_Avoid_: world model, hidden model, solution

**Working Model**:
A team's private deduction workspace containing possible properties, exclusions, and hypotheses. It has no effect on the match until the team submits a thesis or final Scientific Model.
_Avoid_: player model, notes, theory board

**Scientific Model**:
A team's submitted claims about the anomaly, consisting of public theses during play and its final audit submission.
_Avoid_: final model, theory, solution

**Signal**:
One of the six persistent named phenomena in the anomaly registry, such as `Aster`. Its properties are hidden by the Anomaly Configuration.
_Avoid_: sample, ingredient, resource card

**Sample**:
A team's non-consumable access to a Signal for research and laboratory tests. Multiple teams may hold Samples of the same Signal.
_Avoid_: signal, ingredient, consumable

**Raw Telemetry**:
Private discovery data associated with a Sample before its first laboratory use.
_Avoid_: sample, laboratory result, public evidence

## Tender Economy

**Rating**:
The public cumulative score that determines which team wins the Tender. Rating is never spent.
_Avoid_: reputation, budget, score multiplier

**Budget**:
A team's spendable research funding. It pays for early Access Slots and precise work, and is replenished by grants, contracts, and slot compensation.
_Avoid_: rating, points, currency

**Corporate Trust**:
A team's standing with the corporation, which governs eligibility for high-value Contracts. It is not a victory score or a payment resource.
_Avoid_: reputation, rating, budget

## Match Flow

**Access Slot**:
A team's secret round choice that determines operational order, price, and fixed compensation.
_Avoid_: turn order, initiative bid, action space

**Power**:
One of four units that a team allocates across research, analysis, and contract categories each round.
_Avoid_: action point, energy, move

**Phase**:
A shared resolution stage of a round: Reconnaissance, Laboratory, Model Analysis, or Contracts.
_Avoid_: turn, action

**Action**:
A team's confirmed, target-specific decision inside a Phase.
_Avoid_: turn, power, phase

## Evidence

**Directed Test**:
A Laboratory Action that applies a Protocol from one Signal as source to a different Signal as receiver.
_Avoid_: mixture, combination, experiment pair

**Protocol**:
The operating mode of a Directed Test. The MVP protocols are Impulse and Continuous.
_Avoid_: test, power, action

**Public Result**:
The test outcome visible to every team: transmission gain, attenuation, reflection, or unstable collapse.
_Avoid_: evidence, measurement, private result

**Private Measurement**:
An extra parameter from a Continuous Protocol that only the initiating team sees until the post-match audit.
_Avoid_: public result, raw telemetry, evidence

**Thesis**:
A public, immediately checked claim submitted from a team's Scientific Model.
_Avoid_: note, hypothesis, public result

## Tender

**Tender**:
The five-round competitive funding process that ends with the final audit and a winner by Rating.
_Avoid_: match, contract, tournament

**Contract**:
An exclusive corporate request that a team can fulfil during a Tender.
_Avoid_: tender, mission, quest

**Bid**:
A team's contract submission, assessed by effect fit, evidence level, and requested funding.
_Avoid_: contract, reservation, offer

**Challenge**:
A deliberate Bid for a Contract that another team has already reserved.
_Avoid_: sabotage, attack, block

**Final Contract**:
A high-value Contract visible from the first round and resolved in round five.
_Avoid_: final tender, endgame contract
