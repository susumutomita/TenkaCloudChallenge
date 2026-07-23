/**
 * Pure remediation / re-verification logic for wix-exposure-audit, kept separate
 * from server.mjs so it is unit-testable with `bun test` — no HTTP, no Docker.
 * Mirrors the split in challenges/api-idor-demo/local/app/authorization.mjs and
 * the rls-tenant-isolation grader: pure decision logic lives here; server.mjs
 * only wires it to sockets.
 *
 * The final checkpoint is an ORDER-GATED re-verification. Its confirmation flag
 * is emitted ONLY once all three owner controls are closed. Running the
 * re-verification early is a pure, side-effect-free progress report ("N of 3
 * closed") that stays retryable and can never soft-lock the problem, because it
 * never mutates state and the first three checkpoints keep their own flags.
 */

/**
 * The three owner controls that must be closed, in display order. Each maps to a
 * key on the server's in-memory `controls` object. `controls[key]` truthy means
 * the surface is still open (indexable / shareable / collaborator active); the
 * public routes derive from these same flags, so checking them here is the exact
 * state an outside observer would re-verify.
 */
export const REMEDIATION_STEPS = [
  { key: "searchIndexing", label: "preview page の検索公開" },
  { key: "inboxShareActive", label: "問い合わせ受信箱の共有 link" },
  { key: "agencyCollaboratorActive", label: "制作会社の共同編集権限" },
];

/**
 * Progress snapshot over the three controls. `closedCount` / `remaining` back the
 * "N of 3 closed" report; `allClosed` is the gate for emitting the flag.
 */
export function remediationStatus(controls) {
  const remaining = REMEDIATION_STEPS.filter((step) => Boolean(controls[step.key]));
  return {
    total: REMEDIATION_STEPS.length,
    closedCount: REMEDIATION_STEPS.length - remaining.length,
    remaining,
    allClosed: remaining.length === 0,
  };
}

/**
 * Re-verification result. `flag` is the per-deploy confirmation passphrase when —
 * and only when — every control is closed; otherwise it is null and the caller
 * reports progress and stays retryable. Never mutates `controls`.
 */
export function reverify(controls, remediationFlag) {
  const status = remediationStatus(controls);
  return { ...status, flag: status.allClosed ? remediationFlag : null };
}

/**
 * The /verify decision for one checkpoint submission.
 *
 * - Evidence checkpoints (`preview-indexing` / `shared-inbox` / `stale-collaborator`)
 *   pass on their exact per-deploy flag.
 * - `settings-remediation` requires BOTH the re-verification flag AND all controls
 *   closed. The flag is only ever emitted after all three are closed, so this
 *   double gate means a premature or memorized submission can never pass before
 *   the settings are genuinely closed — and a correct submission after closing is
 *   always accepted, so the step is retryable.
 * - An unknown checkpoint id never passes.
 */
export function checkpointCorrect(checkpointId, submission, controls, flags) {
  if (checkpointId === "settings-remediation") {
    return remediationStatus(controls).allClosed && submission === flags["settings-remediation"];
  }
  if (Object.prototype.hasOwnProperty.call(flags, checkpointId)) {
    return submission === flags[checkpointId];
  }
  return false;
}
