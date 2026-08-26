/**
 * Per-test-file wall-clock weights used to balance `scripts/*.test.ts` across the
 * `suite` matrix's CI shards.
 *
 * ## What this replaces
 *
 * `validate-shard.ts`'s `shardOf` used to partition by `position % total` (round
 * robin over the alphabetically sorted file list). That balances FILE COUNT, not
 * WALL TIME, and relies on file cost NOT correlating with alphabetical position —
 * true in general, false for this catalog: the slow `ac26-*` fixture-heavy files
 * sit together alphabetically, which is exactly why the docstring on the old
 * `shardOf` picked round robin over contiguous slicing in the first place. Round
 * robin only avoids CLUSTERING (many slow files in one shard); it does nothing
 * about two slow files landing in the same shard by coincidence of position.
 *
 * That coincidence happened. PR #551 (2026-08-26) measured all four `suite` shards
 * after removing the five per-problem runtime jobs from `ci.yml`: shard 3 took
 * 630s against 379s / 343s / 358s for the other three (1710s total across 123
 * files). The entire gap is explained by two files landing in shard 3 together —
 * `scripts/ac26-w5-pbs-homnand.test.ts` (205s in that batched run) and
 * `scripts/ac26-w6-cosnark-privacy.test.ts` (117s), both at `position % 4 === 2`
 * in the sorted file list — a name-adjacency accident round robin cannot see,
 * because it never looks at cost.
 *
 * ## How these numbers were produced
 *
 * Measured 2026-08-26 in this sandbox (a different machine from any GitHub
 * Actions runner, so treat absolute values as relative weights, not predictions
 * of a real CI shard's wall time — see below): every `scripts/*.test.ts` file
 * that `shardableFiles()` includes (i.e. every suite file except
 * `scripts/solvability-audit.test.ts`, which `SEPARATELY_SCHEDULED_FILES` already
 * excludes from the matrix) run ONE FILE AT A TIME via `bun test <file>`,
 * wall-clock timed immediately before and after the process, with `CI=true` and
 * `npm_config_ignore_scripts=true` set to match `ci.yml`'s `suite` job
 * environment. `scripts/measure-shard-costs.ts` is that exact procedure, kept as
 * a runnable tool rather than a one-off script.
 *
 * Running files one at a time avoids the CPU contention that skews timings when
 * several `bun test` processes compete for the same CPUs — observed directly
 * while preparing this table: running four shards concurrently in this sandbox
 * produced spurious 5-9 second timeouts in fast crypto-fixture tests that pass in
 * under a second alone. It also means these numbers pay Bun's per-process startup
 * and module-resolution cost once per FILE, whereas a real CI shard batches ~30
 * files into a single `bun test` invocation and pays that cost once per SHARD:
 * summed, this table's 123 values total 1898.9s against the 1710s PR #551
 * measured for the same 123 files batched into 4 shards — an overstatement of
 * about 11%, consistent with per-file process-startup overhead. That
 * overstatement is close to uniform across files, so it does not change which
 * file is heavier than which. `shardsByCost` only ever compares relative weight,
 * so this is the right ruler for that job; do not read a single value here as a
 * prediction of that file's contribution to a batched CI shard's wall time.
 *
 * The heaviest file measured this way, `scripts/ac26-w5-pbs-homnand.test.ts` at
 * 229.4s, is somewhat higher than the 205s PR #551 measured for the same file in
 * a batched shard — expected given different hardware and methodology, and
 * irrelevant to correctness: `shardsByCost` only needs it to still be one of the
 * heaviest files, which it is. It is also not alone: this full sweep surfaced
 * four more files PR #551's two-file diagnosis did not name, because that PR
 * only explained ONE shard's outsized total after the fact rather than measuring
 * every file. The six heaviest:
 *
 * | file                                              | seconds |
 * | --------------------------------------------------|---------|
 * | ac26-w5-pbs-homnand.test.ts                        | 229.4   |
 * | ac26-w6-stack-design.test.ts                       | 169.5   |
 * | ac26-w6-zkvm-exploit-predicate.test.ts              | 133.8   |
 * | ac26-w6-cosnark-privacy.test.ts                     | 132.7   |
 * | ac26-w6-zkvm-witness-binding.test.ts                | 73.2    |
 * | ac26-w6-cosnark-beaver.test.ts                      | 72.5    |
 *
 * Spreading all six of these across four shards, not just avoiding the one
 * collision PR #551 could see, is the actual point of packing by measured cost
 * instead of by name-adjacency avoidance.
 *
 * ## Keeping this current
 *
 * Re-measure with `bun run scripts/measure-shard-costs.ts` and replace the table
 * below with its output. There is no automatic staleness check: file cost
 * legitimately drifts as problem content and CI hardware change, and a hard
 * "must match measured reality" gate would fail an unrelated PR for timing drift
 * it did not cause. A file this table does not name — a new test, or a table
 * that has not been re-measured since one was added — is not an error:
 * `costOfFile` below falls back to `DEFAULT_SECONDS`, so adding a shard, or a
 * test file, is never blocked on re-measuring cost. That default is itself drawn
 * from this same measured data (the median of the table below, which is robust
 * to the handful of multi-minute crypto-fixture outliers skewing a mean) rather
 * than a guessed constant.
 */
export const SHARD_COST_SECONDS: Readonly<Record<string, number>> = {
  "scripts/ac26-base-image-digest.test.ts": 0.1,
  "scripts/ac26-bridge-experiment.test.ts": 12.6,
  "scripts/ac26-bridge-properties.test.ts": 17.1,
  "scripts/ac26-premises.test.ts": 0.1,
  "scripts/ac26-w1-constraint-lab.test.ts": 22.7,
  "scripts/ac26-w1-underconstraint.test.ts": 24.3,
  "scripts/ac26-w2-beaver-mul.test.ts": 23.1,
  "scripts/ac26-w2-linear-shares.test.ts": 22.5,
  "scripts/ac26-w2-oblivious-transfer.test.ts": 0.5,
  "scripts/ac26-w2-privacy-audit.test.ts": 24.8,
  "scripts/ac26-w2-private-aggregate.test.ts": 29.6,
  "scripts/ac26-w2-secret-sharing.test.ts": 23.6,
  "scripts/ac26-w3-ec-group.test.ts": 34.7,
  "scripts/ac26-w3-fft-domain.test.ts": 1.3,
  "scripts/ac26-w3-field-inverse.test.ts": 28.9,
  "scripts/ac26-w3-nonce-reuse.test.ts": 38.9,
  "scripts/ac26-w3-ntt-roots.test.ts": 1.1,
  "scripts/ac26-w3-passkey-assertion.test.ts": 43.2,
  "scripts/ac26-w3-schnorr-drill.test.ts": 5.7,
  "scripts/ac26-w3-schnorr.test.ts": 41.1,
  "scripts/ac26-w4-arithmetization.test.ts": 34.2,
  "scripts/ac26-w4-commit-open.test.ts": 34.1,
  "scripts/ac26-w4-fri-drill.test.ts": 4.1,
  "scripts/ac26-w4-plonk-drill.test.ts": 18.1,
  "scripts/ac26-w4-proof-pipeline.test.ts": 34.5,
  "scripts/ac26-w4-sumcheck-drill.test.ts": 3.9,
  "scripts/ac26-w5-cmux-blind-rotation.test.ts": 38.2,
  "scripts/ac26-w5-encoding-noise.test.ts": 33.6,
  "scripts/ac26-w5-extract-key-switch.test.ts": 39.9,
  "scripts/ac26-w5-lwe-rlwe.test.ts": 34.5,
  "scripts/ac26-w5-pbs-homnand.test.ts": 229.4,
  "scripts/ac26-w5-rgsw-external.test.ts": 34.9,
  "scripts/ac26-w6-cosnark-beaver.test.ts": 72.5,
  "scripts/ac26-w6-cosnark-linear.test.ts": 69.0,
  "scripts/ac26-w6-cosnark-privacy.test.ts": 132.7,
  "scripts/ac26-w6-stack-design.test.ts": 169.5,
  "scripts/ac26-w6-zkvm-exploit-predicate.test.ts": 133.8,
  "scripts/ac26-w6-zkvm-witness-binding.test.ts": 73.2,
  "scripts/ac26-w7-capstone-demo.test.ts": 69.4,
  "scripts/ac26-w7-capstone-design.test.ts": 33.8,
  "scripts/agent-approval-gameday.test.ts": 0.2,
  "scripts/ai-riscv-screen-repair.test.ts": 0.1,
  "scripts/ai-riscv-soc-repair.test.ts": 0.1,
  "scripts/asm-worst-case-latency.test.ts": 0.9,
  "scripts/assurance-scope.test.ts": 0.1,
  "scripts/author-artifact-separation.test.ts": 0.3,
  "scripts/check-answer-reachability.test.ts": 0.3,
  "scripts/check-course-drift.test.ts": 0.4,
  "scripts/check-local-play-urls.test.ts": 0.4,
  "scripts/check-participant-surface.test.ts": 0.1,
  "scripts/check-problem.test.ts": 1.1,
  "scripts/check-simulator-compatibility.test.ts": 0.4,
  "scripts/check-workbench-vendoring.test.ts": 0.1,
  "scripts/ci-validate-parity.test.ts": 0.1,
  "scripts/course-alignment-basis.test.ts": 0.1,
  "scripts/course-alignment.test.ts": 0.4,
  "scripts/course-workbench-contract.test.ts": 5.0,
  "scripts/course-workbench-prepare.test.ts": 0.4,
  "scripts/cs-async-result-binding.test.ts": 2.4,
  "scripts/cs-atomic-file-publish.test.ts": 1.2,
  "scripts/cs-auth-claim-audit.test.ts": 1.3,
  "scripts/cs-cache-generation-fence.test.ts": 1.1,
  "scripts/cs-dst-daily-rollup.test.ts": 5.1,
  "scripts/cs-foundations-evidence.test.ts": 2.8,
  "scripts/cs-foundations-learning-path.test.ts": 0.2,
  "scripts/cs-foundations-readiness.test.ts": 0.1,
  "scripts/cs-http-retry-idempotency.test.ts": 2.4,
  "scripts/cs-numeric-aggregation-order.test.ts": 1.2,
  "scripts/cs-protocol-state-guard.test.ts": 0.8,
  "scripts/cs-transaction-visibility-audit.test.ts": 1.0,
  "scripts/database-track-learning-path.test.ts": 0.1,
  "scripts/eventbridge-delivery-discipline-integration.test.ts": 0.1,
  "scripts/eventbridge-delivery-discipline.test.ts": 0.1,
  "scripts/eventbridge-policy-vocabulary.test.ts": 0.4,
  "scripts/github-oidc-trust-boundary.test.ts": 0.1,
  "scripts/hello-multicloud.test.ts": 0.1,
  "scripts/knowledge-graph.test.ts": 0.4,
  "scripts/local-play-compose-project-name.test.ts": 0.3,
  "scripts/local-play-publish-reachability.test.ts": 0.4,
  "scripts/mcp-origin-guardian.test.ts": 0.1,
  "scripts/new-course-challenge.test.ts": 0.1,
  "scripts/new-problem.test.ts": 0.5,
  "scripts/participant-contract.test.ts": 0.3,
  "scripts/pilot-instruments.test.ts": 1.6,
  "scripts/portal-control-names.test.ts": 0.1,
  "scripts/problem-runtimes.test.ts": 0.6,
  "scripts/readme-contract.test.ts": 0.2,
  "scripts/request-target-guard.test.ts": 2.2,
  "scripts/rls-tenant-isolation.test.ts": 0.1,
  "scripts/scaffold-leftover-guard.test.ts": 0.1,
  "scripts/session-manager-policy.test.ts": 0.1,
  "scripts/sha256-bytes-padding.test.ts": 14.5,
  "scripts/sha256-compress-digest.test.ts": 36.8,
  "scripts/sha256-schedule-logic.test.ts": 5.1,
  "scripts/signed-does-not-mean-safe.test.ts": 0.4,
  "scripts/solvability-shard.test.ts": 0.1,
  "scripts/sre-incident-readiness.test.ts": 0.4,
  "scripts/stackstack-base-contract.test.ts": 0.8,
  "scripts/stackstack-base-docs-console.test.ts": 0.2,
  "scripts/stackstack-defend.test.ts": 5.8,
  "scripts/stackstack-first-request.test.ts": 0.5,
  "scripts/stackstack-gameday.test.ts": 68.7,
  "scripts/stackstack-learning-path.test.ts": 0.2,
  "scripts/stackstack-observability.test.ts": 1.3,
  "scripts/stackstack-onboarding.test.ts": 0.7,
  "scripts/stackstack-recover.test.ts": 1.8,
  "scripts/stackstack-safe-exposure.test.ts": 2.2,
  "scripts/stackstack-secrets.test.ts": 2.1,
  "scripts/stackstack-ship.test.ts": 1.0,
  "scripts/stackstack-vibe-build.test.ts": 26.0,
  "scripts/symphony-launcher-contract.test.ts": 0.5,
  "scripts/symphony-security.test.ts": 0.3,
  "scripts/validate-problems.test.ts": 0.3,
  "scripts/validate-shard.test.ts": 0.1,
  "scripts/validate-simulation-overlay.test.ts": 0.2,
  "scripts/verifier-reachability-guard.test.ts": 0.4,
  "scripts/verifier-rlimit-guard.test.ts": 0.1,
  "scripts/verifier-spoof-guard.test.ts": 0.4,
  "scripts/wix-exposure-audit.test.ts": 0.2,
  "scripts/wp-harden-leaks-seeding.test.ts": 0.1,
  "scripts/wp2shell-friday-night-patch.test.ts": 0.1,
  "scripts/wp2shell-local-lab.test.ts": 0.2,
};

/**
 * Weight given to a `scripts/*.test.ts` file that `SHARD_COST_SECONDS` does not
 * name — the median of that table's 123 values (0.9s, measured 2026-08-26) —
 * pinned here rather than recomputed at import time, so this module has no
 * behavior that changes as the table above is edited except the table itself.
 */
export const DEFAULT_SECONDS = 0.9;

/** `SHARD_COST_SECONDS[file]`, or `DEFAULT_SECONDS` for a file the table does not name. */
export function costOfFile(file: string): number {
  return SHARD_COST_SECONDS[file] ?? DEFAULT_SECONDS;
}
