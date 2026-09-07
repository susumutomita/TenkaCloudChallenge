import {
  ALL_PERMUTATIONS,
  applyPermutation,
  type Permutation,
} from "./sudoku.ts";
/** Author-only capacity traces. Correct private answers are test oracles here,
 * not evidence of participant recovery. Every operation still passes the real
 * validator and reducer; no synthetic ledger/hunt entries are injected.
 *
 * rapid-leak maximizes rotation opportunities with the full disclosure ledger;
 * rapid-prove uses the same 31 generations but exposes Sudoku in each batch;
 * reuse holds the pressure generation so three Vigenère positions can collect.
 * These are different legal routes, not a claim that incompatible choices happen
 * simultaneously. Their entire transition peaks are measured, including pending
 * RPS before opening and exact, distinct HUNT times within each generation.
 */
import { createMeter } from "./capacity-bytes.fixture.ts";
import {
  deriveCipherKey,
  deriveContractPlan,
  deriveRotorPositions,
  deriveSudokuSolution,
  deriveRsaKey,
} from "./fixtures.ts";
import { HINT_LEVELS } from "./hints.ts";
import { buildClearingOp, buildProveSudokuOp } from "./playtest.ts";
import {
  applyOp,
  DEFAULT_CONFIG,
  initialState,
  projectForTeam,
  tick,
  validateOp,
} from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";
export type CapacityRoute = "rapid-leak" | "rapid-prove" | "reuse";
const START = 1788595200000,
  END = 90 * 60000;

/** All three pressure Rotor slots are normal, not replaced by a rush Order. */
export function capacityRoster(teamCount: number): string[] {
  const ids: string[] = [];
  for (let i = 0; ids.length < teamCount; i++) {
    const id = String(i).padStart(26, "0");
    if (
      [36, 46, 56].every(
        (seq) =>
          deriveContractPlan(
            "s".repeat(64),
            id,
            seq,
            {
              prime: BigInt(DEFAULT_CONFIG.prime),
              shareCount: DEFAULT_CONFIG.shareCount,
            },
            { elapsedMs: seq * 60000, ...DEFAULT_CONFIG.phaseBoundaries },
          ).taskKind === "rotor-encrypt",
      )
    )
      ids.push(id);
  }
  return ids;
}

export function playCapacityTrace(
  teamCount: number,
  route: CapacityRoute,
  onIssue?: (minute: number, bytes: number) => void,
) {
  const teamIds = capacityRoster(teamCount);
  let state = applyOp(
    tick(
      initialState({
        eventId: "state-size",
        teamIds,
        matchSecret: "s".repeat(64),
      }),
      START,
    ),
    teamIds[0]!,
    { kind: "start" },
  );
  const meter = createMeter();
  let peak = 0,
    peakState = state,
    pendingPeak = 0,
    transitions = 0;
  const successes = {
    share: 0,
    caesar: 0,
    vigenere: 0,
    rotor: 0,
    sudoku: 0,
    rsa: 0,
  };
  let rotations = 0;
  const observe = () => {
    transitions++;
    const bytes = meter(state);
    if (bytes > peak) {
      peak = bytes;
      peakState = state;
    }
    pendingPeak = Math.max(
      pendingPeak,
      state.contracts.reduce(
        (n, c) => n + Object.keys(c.rps?.predictions ?? {}).length,
        0,
      ),
    );
  };
  const advance = (elapsed: number) => {
    state = tick(state, START + elapsed);
    observe();
  };
  const submit = (team: string, op: CryptoBattleOp) => {
    const verdict = validateOp(state, team, op);
    if (!verdict.ok) throw new Error(`Capacity ${op.kind}: ${verdict.error}`);
    state = applyOp(state, team, op);
    observe();
  };
  const possible = (team: string, op: CryptoBattleOp) => {
    if (!validateOp(state, team, op).ok) return false;
    submit(team, op);
    return true;
  };
  observe();
  type Event = {
    at: number;
    kind: "issue" | "rotate" | "hunt" | "sudoku" | "rsa";
    pos?: number;
    generation?: number;
  };
  const events: Event[] = [];
  for (let at = 0; at < END; at = at === 0 ? 60000 : at + 300000)
    events.push({ at, kind: "issue" });
  const spread = (pos: number, duration: number) =>
    teamCount <= 2 ? 0 : Math.floor((pos * (duration - 1)) / (teamCount - 2));
  if (route !== "reuse") {
    for (let generation = 1; generation <= 31; generation++) {
      const start = generation === 1 ? 0 : 90000 + (generation - 2) * 180000;
      const end =
        generation === 1 ? 90000 : generation === 31 ? END : start + 180000;
      if (generation > 1) events.push({ at: start, kind: "rotate" });
      for (let pos = 0; pos < teamCount - 1; pos++)
        events.push({
          at: start + spread(pos, end - start),
          kind: "hunt",
          pos,
          generation,
        });
    }
    if (route === "rapid-prove")
      for (let issue = 60000; issue < END; issue += 300000) {
        const generation =
          issue < 90000 ? 1 : 2 + Math.floor((issue - 90000) / 180000);
        const end =
          generation === 1
            ? 90000
            : generation === 31
              ? END
              : 90000 + (generation - 1) * 180000;
        for (let pos = 0; pos < teamCount - 1; pos++)
          events.push({
            at: issue + spread(pos, end - issue),
            kind: "sudoku",
            pos,
          });
      }
  }
  if (route !== "reuse")
    for (let generation = 21; generation <= 31; generation++) {
      const start = Math.max(3600000, 90000 + (generation - 2) * 180000),
        end = generation === 31 ? END : 90000 + (generation - 1) * 180000;
      for (let pos = 0; pos < teamCount - 1; pos++)
        events.push({
          at: start + spread(pos, end - start),
          kind: "rsa",
          pos,
          generation,
        });
    }
  const priority = { issue: 0, rotate: 1, hunt: 2, sudoku: 3, rsa: 4 };
  events.sort((a, b) => a.at - b.at || priority[a.kind] - priority[b.kind]);
  const rsaGenerations = new Set<number>();
  const chosenPermutations = new Map<string, Permutation>();
  const tryHunt = (
    attacker: string,
    target: string,
    method: keyof typeof successes,
  ) => {
    const generation = state.teams[target]!.generation;
    let op: CryptoBattleOp;
    switch (method) {
      case "share":
        op = {
          kind: "hunt",
          targetTeamId: target,
          generation,
          recoveredSecret: state.teams[target]!.secret,
        };
        break;
      case "caesar":
      case "vigenere":
        op = {
          kind: "hunt-cipher",
          targetTeamId: target,
          generation,
          rung: method,
          recoveredKey: deriveCipherKey(state.seed, target, generation, method),
        };
        break;
      case "sudoku":
        op = {
          kind: "hunt-sudoku",
          targetTeamId: target,
          generation,
          solution: deriveSudokuSolution(state.seed, target, generation),
        };
        break;
      case "rotor":
        op = {
          kind: "hunt-rotor",
          targetTeamId: target,
          generation,
          ...deriveRotorPositions(state.seed, target, generation),
        };
        break;
      case "rsa": {
        const key = deriveRsaKey(state.seed, target, generation);
        op = {
          kind: "hunt-rsa",
          targetTeamId: target,
          generation,
          p: String(key.p),
          q: String(key.q),
        };
        break;
      }
    }
    if (possible(attacker, op)) successes[method]++;
  };
  const allPairs = (methods: readonly (keyof typeof successes)[]) => {
    for (const target of teamIds)
      for (const attacker of teamIds)
        if (attacker !== target)
          for (const method of methods) tryHunt(attacker, target, method);
  };
  for (const event of events) {
    advance(event.at);
    if (event.kind === "rotate") {
      for (const id of teamIds) {
        submit(id, { kind: "rotate" });
        rotations++;
      }
      continue;
    }
    const generation = state.teams[teamIds[0]!]!.generation;
    if (
      route === "reuse" &&
      state.phase === "endgame" &&
      !rsaGenerations.has(generation)
    ) {
      rsaGenerations.add(generation);
      allPairs(["rsa"]);
    }
    if (
      event.kind === "hunt" ||
      event.kind === "sudoku" ||
      event.kind === "rsa"
    ) {
      for (const [targetIndex, target] of teamIds.entries()) {
        const pos = event.pos!,
          attacker = teamIds[pos < targetIndex ? pos : pos + 1]!;
        if (event.kind === "hunt") {
          if (state.teams[target]!.generation !== event.generation)
            throw new Error("Unexpected HUNT generation");
          const before = successes.share + successes.caesar;
          tryHunt(attacker, target, "share");
          tryHunt(attacker, target, "caesar");
          if (successes.share + successes.caesar !== before + 2)
            throw new Error("A legal 31-generation HUNT was omitted");
        } else if (event.kind === "rsa") {
          const before = successes.rsa;
          tryHunt(attacker, target, "rsa");
          if (successes.rsa !== before + 1)
            throw new Error("A legal timed RSA HUNT was omitted");
          rsaGenerations.add(state.teams[target]!.generation);
        } else tryHunt(attacker, target, "sudoku");
      }
      continue;
    }
    for (const id of teamIds) {
      for (const c of state.contracts.filter(
        (c) => c.teamId === id && c.status === "open",
      ))
        for (let level = 0; level < HINT_LEVELS; level++)
          possible(id, { kind: "reveal-hint", contractId: c.id });
      // Persist the real lightning decision and CIPHER miss/forfeiture fields,
      // then LEAK the same Order. Trials choose a valid wrong answer without
      // ever writing a made-up verdict or changing the played state's history.
      for (const c of state.contracts.filter(
        (c) => c.teamId === id && c.status === "open",
      ))
        possible(id, { kind: "declare-lightning", contractId: c.id });
      for (const c of state.contracts.filter(
        (c) =>
          c.teamId === id &&
          c.status === "open" &&
          (c.task.kind === "rotor-encrypt" ||
            c.task.kind === "rsa-encrypt" ||
            (c.task.kind === "caesar-shift" && c.task.rung === "vigenere")),
      )) {
        const length =
          c.task.kind === "rotor-encrypt"
            ? 4
            : c.task.kind === "caesar-shift"
              ? c.task.plaintext.length
              : 1;
        let op = {
          kind: "cipher" as const,
          contractId: c.id,
          answer: Array<string>(length).fill("0"),
        };
        if (!validateOp(state, id, op).ok)
          throw new Error("Invalid capacity CIPHER shape");
        const trial = applyOp(state, id, op);
        if (trial.contracts.find((x) => x.id === c.id)?.status === "completed")
          op = { ...op, answer: Array<string>(length).fill("1") };
        submit(id, op);
        if (state.contracts.find((x) => x.id === c.id)?.cipherFailed !== true)
          throw new Error("Capacity CIPHER miss was not recorded");
      }
      if (route !== "rapid-leak") {
        const proving = state.contracts.filter(
          (c) =>
            c.teamId === id &&
            c.status === "open" &&
            c.allowedMethods.includes("prove"),
        );
        const key = `${id}:${state.teams[id]!.generation}`;
        let pi = chosenPermutations.get(key);
        if (!pi && proving.length) {
          pi = [2, 1, 3, 4];
          // Author-only adversarial selection: prefer a legal reused permutation
          // whose actual two reveals satisfy the server's public-material gate.
          // No trial state or failed predicate is injected into the played route.
          const hunter = teamIds.find((team) => team !== id);
          if (hunter && proving.length >= 2)
            for (const candidate of [pi, ...ALL_PERMUTATIONS]) {
              if (candidate.every((value, i) => value === i + 1)) continue;
              let trial = state;
              for (const c of proving) {
                const op = {
                  kind: "prove-sudoku" as const,
                  contractId: c.id,
                  grid: applyPermutation(
                    deriveSudokuSolution(
                      trial.seed,
                      id,
                      trial.teams[id]!.generation,
                    ),
                    candidate,
                  ),
                };
                if (!validateOp(trial, id, op).ok)
                  throw new Error("Invalid trial PROVE");
                trial = applyOp(trial, id, op);
              }
              if (
                validateOp(trial, hunter, {
                  kind: "hunt-sudoku",
                  targetTeamId: id,
                  generation: trial.teams[id]!.generation,
                  solution: deriveSudokuSolution(
                    trial.seed,
                    id,
                    trial.teams[id]!.generation,
                  ),
                }).ok
              ) {
                pi = candidate;
                break;
              }
            }
          chosenPermutations.set(key, pi);
        }
        for (const c of proving)
          submit(
            id,
            buildProveSudokuOp(projectForTeam(state, id).vault, c.id, pi),
          );
      }
      for (const c of state.contracts.filter(
        (c) =>
          c.teamId === id &&
          c.status === "open" &&
          c.allowedMethods.includes("leak"),
      ))
        submit(id, { kind: "leak", contractId: c.id });
      const projection = projectForTeam(state, id);
      for (const c of projection.myContracts.filter(
        (c) => c.status === "open" && c.task.kind !== "rps-duel",
      )) {
        const op = buildClearingOp(
          c,
          projectForTeam(state, id).vault,
          projection.prime,
        );
        if (!op) throw new Error("Unhandled capacity Order");
        submit(id, op);
      }
    }
    allPairs(
      route === "reuse"
        ? ["share", "caesar", "vigenere", "sudoku", "rotor"]
        : ["rotor"],
    );
    for (const kind of ["rps-commit", "rps-open"] as const) {
      if (kind === "rps-open") {
        for (const c of state.contracts)
          if (c.status === "open" && c.task.kind === "rps-duel")
            for (const hunter of teamIds)
              if (hunter !== c.teamId)
                possible(hunter, {
                  kind: "hunt-rps",
                  targetTeamId: c.teamId,
                  duelId: c.task.duelId,
                  predictedHand: 1,
                });
      }
      for (const id of teamIds)
        for (const c of state.contracts.filter(
          (c) =>
            c.teamId === id &&
            c.status === "open" &&
            c.task.kind === "rps-duel",
        ))
          submit(
            id,
            kind === "rps-commit"
              ? { kind, contractId: c.id, commitment: 13 }
              : { kind, contractId: c.id, hand: 1, randomness: 1 },
          );
    }
    if (
      route === "reuse" &&
      event.at >= 60000 &&
      (event.at < 1800000 || event.at >= 3600000)
    )
      for (const id of teamIds)
        if (possible(id, { kind: "rotate" })) rotations++;
    onIssue?.(event.at / 60000, meter(state));
    if (meter(state) !== Buffer.byteLength(JSON.stringify(state)))
      throw new Error("Capacity meter differs from exact JSON bytes");
  }
  const final = Buffer.byteLength(JSON.stringify(state));
  if (
    meter(state) !== final ||
    meter(peakState) !== Buffer.byteLength(JSON.stringify(peakState))
  )
    throw new Error("Capacity peak meter mismatch");
  return {
    state,
    peakState,
    peak,
    final,
    pendingPeak,
    transitions,
    successes,
    rotations,
    rsaGenerations: [...rsaGenerations],
  };
}
