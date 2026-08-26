#!/usr/bin/env bun
/**
 * Static detector for Issue #537: graded-checkpoint answers reachable from the
 * participant image.
 *
 * ## What #537 found that `author-artifact-separation.test.ts` does not
 *
 * That guard only asks whether `reference/` and `mutation.py` stay out of the
 * `participant` Docker stage. Every leak in #537 answers that question "yes" and
 * leaks anyway, because the ground truth for a graded checkpoint was written into a
 * file that is *supposed* to ship to the participant — `fixtures/generate.py`, or
 * `verifier/server.py` itself when the whole verifier is baked into the single
 * `participant` stage (this catalog's local-play problems run their own scoring
 * server inside the image a learner builds; see `verifier-reachability-guard.test.ts`).
 * The worst shape, the four `*-drill` problems: `CODE_CHECKPOINTS` is empty, so every
 * graded line is graded by comparing the submission to
 * `setting(SEED)["expected"][line]` — and `setting` is a plain function in
 * `fixtures/generate.py`, importable from inside the learner's own container.
 *
 * ## Two independent static rules
 *
 * Neither rule needs Docker, a running verifier, or the actual secret value — both
 * work from source text alone, which is what makes them CI-fast and exact-answer-free
 * (findings name a *function*, never a value).
 *
 * ### Rule 1 — `direct-value-comparison`
 *
 * A checker function inside `verifier/server.py` (matched by `_check_*` naming, the
 * convention every local-play verifier uses) calls a name that is reachable from the
 * participant image, and its body contains `==`. "Reachable" means either:
 *
 *   - imported via `from <module> import ...` where `<module>` resolves to a file the
 *     `participant` Docker stage copies in (derived from the Dockerfile itself, see
 *     `lib/local-play-problems.ts#participantPythonFiles` — the same derivation
 *     `author-artifact-separation.test.ts` uses for its own participant-path check), or
 *   - **any** top-level function defined directly in `verifier/server.py`, underscore-
 *     prefixed or not.
 *
 * That second bullet used to say *non-underscore*, on the reading that a leading
 * underscore is this catalog's own marker for "verifier-internal" — which it is, but
 * only in the sense `ac26-w1-underconstraint`'s `_expected_root_cause` states in its own
 * docstring: "it is not exported from `fixtures/generate.py` and nothing on the
 * participant's reading path ... imports it." That is a claim about `fixtures`, not
 * about the Docker stage. When `verifier/server.py` itself ships to the participant —
 * the precondition this rule already tests for — the learner imports the module and
 * calls the underscore name directly, so the prefix protects nothing. Reading it as a
 * boundary is exactly why the detector stayed silent on `ac26-w1-underconstraint` after
 * #533 moved its derivation from `fixtures/generate.py` into the (still-shipping)
 * verifier, leaving 40 of 300 points one import away until the #567 container split
 * (Issue #525, condition 3).
 *
 * Two functions are excluded from being *sources* of a match:
 *
 *   - Sandboxed code-checkpoint runners (a body containing `subprocess.run(` or
 *     `TemporaryDirectory(`) — these execute the learner's own submitted code; an
 *     `==` inside one checks a subprocess exit code or a JSON shape, not a secret.
 *     This exclusion only holds if the runner's body is actually read to the end, which
 *     is why `topLevelFunctions` has to follow a wrapped `def` signature.
 *   - `_check_environment` by name. Every local-play verifier that has one grades a
 *     liveness/setup token (`health_token` and equivalents) that `show.py` already
 *     prints to the participant directly (verified against the catalog, not assumed);
 *     asking them to paste it back is not the checkpoint the value would be spoiling.
 *
 * ### Rule 2 — `stub-vs-implementation`
 *
 * `starter/*.py` defines a module-level function whose body is a placeholder (`return
 * ()`, `pass`, `raise NotImplementedError(...)`, a docstring with no statement, ...),
 * and some *other* participant-reachable, non-`starter`, non-`tests` module in the same
 * problem defines a function of the exact same name with a real body. The clearest
 * instances in #537 (`ac26-w4-commit-open`'s `node_hash`, `ac26-w5-lwe-rlwe`'s
 * `ring_mul` and siblings) are exactly this: the thing the starter tells the learner to
 * implement is already fully implemented, under the same name, in `fixtures/generate.py`
 * — which the learner's own container can `import` directly.
 *
 * This rule is name-matching, so it does not catch a leak that uses a *different* name
 * for the same computation (`ac26-w3-field-inverse` ships a full extended-Euclid
 * implementation as `egcd`/`egcd_rows` while the starter's stub is a class method named
 * `inverse` — no name collision, no match). That gap is real and is called out in the
 * PR description rather than papered over with a fuzzier heuristic that would cost
 * false positives elsewhere.
 *
 * ## What this deliberately does not attempt
 *
 * A checker calling a reachable function inside an `==` is not automatically a leak —
 * `ac26-bridge-experiment`'s `_check_predict` compares against arithmetic over
 * `public_case(SEED)`, which is the params the problem statement hands the learner to
 * compute the prediction *from*; the exercise is doing the arithmetic, not finding the
 * inputs. This detector does not try to tell that apart from a real leak by anything
 * other name-based exclusions above, so `check-answer-reachability.test.ts` records
 * every checkpoint-level finding it produces on the real catalog and each one is
 * reviewed by hand for whether it names a genuine leak; the PR description reports the
 * result. Over-flagging inside a problem that is already a genuine leak for another
 * checkpoint costs nothing (the problem was going in the baseline either way); a
 * standalone false positive on an otherwise-clean problem would need a new baseline
 * entry to explain, which is the forcing function that surfaces it.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { localPlayProblemDirs, participantPythonFiles } from "./lib/local-play-problems";

export interface AnswerLeakFinding {
  readonly problem: string;
  /** Checker function name (rule 1) or the colliding function name (rule 2). */
  readonly checkpoint: string;
  readonly rule: "direct-value-comparison" | "stub-vs-implementation";
  /** Repo-relative path of the module supplying the leaking value or implementation. */
  readonly module: string;
  readonly detail: string;
}

const REPO_ROOT = new URL("..", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Minimal, deliberately non-general Python source helpers. General enough for the
// shapes this catalog actually uses (verified against every local-play problem while
// building this file), not a Python parser.
// ---------------------------------------------------------------------------

/**
 * Blank out triple-quoted string literals, preserving line count.
 *
 * Removes docstrings (irrelevant prose that could otherwise false-match a reachable
 * name mentioned only in an explanation) and embedded sandboxed-runner script bodies
 * (Python source assigned to a string constant and `exec`'d in a subprocess — not this
 * file's own control flow).
 */
function stripTripleQuoted(source: string): string {
  return source.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, (match) =>
    "\n".repeat((match.match(/\n/g) ?? []).length),
  );
}

/**
 * `from <dotted.module> import a, b as c, ...` — single-line and the parenthesised
 * multi-line form both appear in this catalog. Returns imported-name -> dotted module.
 */
export function parseFromImports(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const record = (moduleDotted: string, namesText: string) => {
    for (const raw of namesText.split(",")) {
      const parts = raw.trim().split(/\s+as\s+/);
      // The name bound in *this* file's scope is the alias when there is one —
      // `setting as cfg` makes `cfg` the reachable name, not `setting`.
      const name = (parts.length > 1 ? parts[1] : parts[0])?.trim();
      if (name) result.set(name, moduleDotted);
    }
  };
  const multiLine = /^from\s+([\w.]+)\s+import\s+\(([\s\S]*?)\)/gm;
  for (const match of source.matchAll(multiLine)) {
    record(match[1] ?? "", match[2] ?? "");
  }
  const withoutMultiLine = source.replace(multiLine, "");
  const singleLine = /^from\s+([\w.]+)\s+import\s+([^(\n][^\n]*)$/gm;
  for (const match of withoutMultiLine.matchAll(singleLine)) {
    record(match[1] ?? "", match[2] ?? "");
  }
  return result;
}

/** `fixtures.generate` + a problem dir -> the repo-relative file it names. */
function moduleFile(dir: string, moduleDotted: string): string {
  return `${dir}/local/${moduleDotted.replace(/\./g, "/")}.py`;
}

/**
 * Every module-level (`def` at column 0) function's full text, name -> body.
 *
 * Deliberately misses class methods (indented `def`s) — Rule 2's known gap on
 * `ac26-w3-field-inverse`'s method-shaped starter is a direct consequence, documented
 * above rather than chased with indentation-tracking that the rest of the catalog does
 * not need.
 */
/**
 * Net `(`-minus-`)` on one line, ignoring parentheses inside quoted defaults such as
 * `sep: str = ")"`. Single-quoted literals only — triple-quoted ones are already blanked
 * by `stripTripleQuoted` before this file sees them.
 */
function parenDepth(line: string): number {
  const bare = line.replace(/#.*$/, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  return (bare.match(/\(/g) ?? []).length - (bare.match(/\)/g) ?? []).length;
}

export function topLevelFunctions(source: string): Map<string, string> {
  const lines = source.split("\n");
  const result = new Map<string, string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const match = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const name = match[1] ?? "";
    const bodyLines = [line];
    i++;
    // A wrapped signature closes on a line starting at column 0 (`) -> bool:`), which
    // the indentation test below reads as "next top-level statement" and stops on,
    // leaving a body of nothing but the first signature line. Everything downstream
    // then draws the wrong conclusion from it: `isStubBody` sees zero statements and
    // calls a fully implemented function a stub, and a sandbox runner whose
    // `subprocess.run(` sits past the wrap stops looking like a runner
    // (`ac26-w3-passkey-assertion`'s `_run_submission_script`, found while widening
    // Rule 1 for Issue #525). Consume continuation lines until the parentheses close.
    let depth = parenDepth(line);
    while (depth > 0 && i < lines.length) {
      const continuation = lines[i] ?? "";
      bodyLines.push(continuation);
      depth += parenDepth(continuation);
      i++;
    }
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() !== "" && !/^[ \t]/.test(next)) break;
      bodyLines.push(next);
      i++;
    }
    result.set(name, bodyLines.join("\n"));
  }
  return result;
}

/** `topLevelFunctions`, with docstrings/embedded scripts already blanked out. */
function moduleLevelDefs(source: string): Map<string, string> {
  return topLevelFunctions(stripTripleQuoted(source));
}

const TRIVIAL_STUB_STATEMENTS = new Set([
  "return ()",
  "return []",
  "return {}",
  'return ""',
  "return ''",
  'return b""',
  "return b''",
  "return False",
  "return True",
  "return None",
  "return 0",
  "pass",
  "...",
]);

/**
 * Is this function body an unfinished placeholder rather than a real implementation?
 *
 * A stub in this catalog's starters is: nothing but a (now-blanked) docstring, or
 * exactly one statement that is a bare trivial-literal `return`, `pass`, `...`, or a
 * `raise NotImplementedError`. Two or more real statements, or a single statement doing
 * anything other than returning a constant, is treated as substantive — matching every
 * starter stub found while building this file (`ac26-w4-commit-open`'s `node_hash`
 * returning `b""`, `ac26-w5-lwe-rlwe`'s `ring_mul` returning `()`, ...).
 */
export function isStubBody(body: string): boolean {
  const statements = body
    .split("\n")
    .slice(1) // drop the `def ...:` line itself
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0);
  if (statements.length === 0) return true; // docstring-only body, no statement at all
  if (statements.length > 1) return false;
  const only = statements[0] ?? "";
  return (
    TRIVIAL_STUB_STATEMENTS.has(only) ||
    isTrivialCollectionReturn(only) ||
    /^raise\s+NotImplementedError\b/.test(only)
  );
}

/**
 * `return (0, 0, 0)` is as much a placeholder as `return 0`, but enumerating every
 * arity and element type in TRIVIAL_STUB_STATEMENTS does not scale — the list already
 * missed `ac26-w3-field-inverse`'s `egcd`, which Issue 537 records as a confirmed leak
 * of 70-145 of its 200 points. That stub sat undetected purely because its placeholder
 * is a 3-tuple rather than a bare scalar.
 *
 * So decide structurally instead: a single `return` of a tuple, list, set, or dict
 * display whose every element is itself a trivial literal is a placeholder. A
 * collection holding anything computed (a name, a call, an operator) is not, and stays
 * substantive — `return (a, b)` and `return [egcd(a, b)]` are real work, not stubs.
 */
export function isTrivialCollectionReturn(statement: string): boolean {
  const match = /^return\s+(.+)$/.exec(statement);
  if (!match) return false;
  const expression = (match[1] ?? "").trim();

  const pairs: readonly (readonly [string, string])[] = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  const pair = pairs.find(([open, close]) => expression.startsWith(open) && expression.endsWith(close));
  if (!pair) return false;

  const inner = expression.slice(1, -1).trim();
  if (inner.length === 0) return true; // `return ()` / `return []` / `return {}`

  // Only flat displays: a nested bracket means structure this check should not judge.
  if (/[([{)\]}]/.test(inner)) return false;

  return inner
    .split(",")
    .map((element) => element.trim())
    .filter((element) => element.length > 0)
    .every((element) => TRIVIAL_STUB_STATEMENTS.has(`return ${element}`));
}

// ---------------------------------------------------------------------------
// Rule 1 — direct-value-comparison
// ---------------------------------------------------------------------------

/** Verifier functions whose own logic is irrelevant: they run the learner's code. */
function sandboxRunnerNames(fns: Map<string, string>): Set<string> {
  return new Set(
    [...fns.entries()]
      .filter(([, body]) => /subprocess\.run\(|TemporaryDirectory\(/.test(body))
      .map(([name]) => name),
  );
}

export function findDirectValueComparisons(
  repoRoot: string,
  dir: string,
  participantPy: readonly string[],
): AnswerLeakFinding[] {
  const verifierRelative = `${dir}/local/verifier/server.py`;
  if (!participantPy.includes(verifierRelative)) return [];
  const source = readFileSync(join(repoRoot, verifierRelative), "utf8");

  const imports = parseFromImports(source);
  const reachableImported = new Map<string, string>(); // name -> repo-relative module file
  for (const [name, moduleDotted] of imports) {
    if (moduleDotted === "tests.hidden" || moduleDotted.startsWith("tests.hidden.")) continue;
    const file = moduleFile(dir, moduleDotted);
    if (participantPy.includes(file)) reachableImported.set(name, file);
  }

  const fns = moduleLevelDefs(source);
  const runnerNames = sandboxRunnerNames(fns);
  // Every top-level function in this file, underscore-prefixed or not. Rule 1 only runs
  // at all when `verifier/server.py` is itself in the participant image (the guard
  // above), and at that point a leading underscore protects nothing: the learner's own
  // container can `import` the module and call `_expected_root_cause` exactly as it
  // calls `reference_schedule`. Treating the prefix as a boundary here is what let
  // `ac26-w1-underconstraint` sit unflagged through #533 while 40 of its 300 points were
  // one import away (Issue #525); the convention marks "not re-exported from
  // `fixtures/generate.py`", which is a statement about `fixtures`, not about what ships.
  const reachableLocal = new Set([...fns.keys()].filter((name) => !runnerNames.has(name)));
  const reachableNames = new Map<string, string>(reachableImported);
  for (const name of reachableLocal) {
    if (!reachableNames.has(name)) reachableNames.set(name, verifierRelative);
  }

  const findings: AnswerLeakFinding[] = [];
  for (const [name, body] of fns) {
    // Only the `_check_*` checkers grade a checkpoint directly; `evaluate` itself is
    // just their dispatcher (and scanning it would self-match its own `def evaluate(`
    // line whenever `evaluate` is also a reachable-local name).
    if (!/^_check_/.test(name)) continue;
    if (name === "_check_environment") continue; // see file doc-comment
    if (runnerNames.has(name)) continue;
    const match = leakingComparison(body, reachableNames);
    if (match) {
      findings.push({
        problem: basename(dir),
        checkpoint: name,
        rule: "direct-value-comparison",
        module: match.module,
        detail: `\`${name}\` compares a submission against \`${match.reachable}(...)\`, which ships in the participant image.`,
      });
    }
  }
  return findings;
}

/**
 * Does this function body compare a submission against a value that came, at most one
 * assignment away, from calling a reachable name?
 *
 * Deliberately single-hop: track a variable only when it is assigned *directly* from a
 * reachable call (`x = reachable(...)`, an attribute/subscript chain off one, or a
 * tuple-unpack of one) on one line, then look for `==`/`!=` on a line that mentions that
 * variable or a bare reachable call. This is what tells
 * `ac26-w2-secret-sharing`'s `_check_threshold` apart from a real leak: it assigns
 * `cfg = setting(SEED)` (tracked) but then reads `n` out of `cfg["n"]` on a *separate*
 * assignment — a second hop this function does not take — before comparing `n`. `n` is
 * also the exact value `show.py` already prints as the participant's own setup, which is
 * why that second hop existing at all would not have made it a leak either; single-hop
 * tracking gets the same answer without needing to know that.
 *
 * The real leaks all clear this bar in one hop: the drill's
 * `expected = setting(SEED)["expected"][line]` then `got == expected`,
 * `ac26-bridge-experiment`'s `_case, _trace, broke_at = corrupted_trace(seed)` then
 * `value == broke_at`, and the direct `w == instance(SEED).witness` /
 * `value == validity_window(SEED)` forms that need no assignment at all.
 */
function leakingComparison(
  body: string,
  reachableNames: Map<string, string>,
): { reachable: string; module: string } | null {
  const lines = body.split("\n");
  const tracked = new Map<string, { reachable: string; module: string }>();
  for (const line of lines) {
    const assign = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=\s*(.+)$/.exec(
      line,
    );
    if (!assign) continue;
    const targets = (assign[1] ?? "").split(",").map((s) => s.trim());
    const rhs = (assign[2] ?? "").trim();
    for (const [reachable, module] of reachableNames) {
      if (new RegExp(`^${reachable}\\s*\\(`).test(rhs)) {
        for (const target of targets) tracked.set(target, { reachable, module });
      }
    }
  }
  for (const line of lines) {
    if (!/==|!=/.test(line)) continue;
    for (const [reachable, module] of reachableNames) {
      if (new RegExp(`\\b${reachable}\\s*\\(`).test(line)) return { reachable, module };
    }
    for (const [name, source] of tracked) {
      if (new RegExp(`\\b${name}\\b`).test(line)) return source;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule 2 — stub-vs-implementation
// ---------------------------------------------------------------------------

export function findStubVsImplementation(
  repoRoot: string,
  dir: string,
  participantPy: readonly string[],
): AnswerLeakFinding[] {
  const starterFiles = participantPy.filter((file) => file.startsWith(`${dir}/local/starter/`));
  const otherFiles = participantPy.filter(
    (file) =>
      !file.startsWith(`${dir}/local/starter/`) && !file.startsWith(`${dir}/local/tests/`),
  );
  if (starterFiles.length === 0 || otherFiles.length === 0) return [];

  const otherDefsByFile = new Map<string, Map<string, string>>();
  for (const file of otherFiles) {
    const defs = moduleLevelDefs(readFileSync(join(repoRoot, file), "utf8"));
    // Every verifier defines a checkpoint dispatcher literally named `evaluate`
    // (`def evaluate(checkpoint_id, submission)` / `def evaluate(checkpoint, submission)`
    // — confirmed catalog-wide). A problem whose own exercise happens to also be called
    // `evaluate` (`ac26-w4-arithmetization`'s "evaluate this polynomial at x") would
    // otherwise collide with that unrelated framework function by name alone.
    if (file.endsWith("/verifier/server.py")) defs.delete("evaluate");
    otherDefsByFile.set(file, defs);
  }

  const findings: AnswerLeakFinding[] = [];
  for (const starterFile of starterFiles) {
    const starterDefs = moduleLevelDefs(readFileSync(join(repoRoot, starterFile), "utf8"));
    for (const [name, body] of starterDefs) {
      if (!isStubBody(body)) continue;
      for (const [otherFile, otherDefs] of otherDefsByFile) {
        const otherBody = otherDefs.get(name);
        if (otherBody !== undefined && !isStubBody(otherBody)) {
          findings.push({
            problem: basename(dir),
            checkpoint: name,
            rule: "stub-vs-implementation",
            module: otherFile,
            detail: `starter defines \`${name}\` as an unfinished stub, but \`${otherFile}\` already ships a complete implementation of the same name.`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------

export function findAnswerReachabilityIssues(repoRoot: string, dir: string): AnswerLeakFinding[] {
  const participantPy = participantPythonFiles(repoRoot, dir);
  return [
    ...findDirectValueComparisons(repoRoot, dir, participantPy),
    ...findStubVsImplementation(repoRoot, dir, participantPy),
  ];
}

function main(): number {
  const findings = localPlayProblemDirs(REPO_ROOT).flatMap((dir) =>
    findAnswerReachabilityIssues(REPO_ROOT, dir),
  );
  if (findings.length === 0) {
    console.log("OK: no participant-reachable graded-checkpoint answers found.");
    return 0;
  }
  for (const finding of findings) {
    console.log(`${finding.problem}  [${finding.rule}]  ${finding.checkpoint} <- ${finding.module}`);
    console.log(`    ${finding.detail}`);
  }
  console.log(`\n${findings.length} finding(s) across the catalog.`);
  return 0; // reporting only; the enforcement gate lives in check-answer-reachability.test.ts
}

if (import.meta.main) process.exit(main());
