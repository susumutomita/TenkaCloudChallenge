#!/usr/local/bin/node
/**
 * db-battle-slow-apparently — Phase 1 diagnosis submission CLI.
 *
 * Run from the participant's own terminal (this container has no browser
 * workbench; `psql` and this script are the whole toolkit):
 *
 *   node bin/diagnose.mjs \
 *     --pid <backend pid you found in pg_stat_activity> \
 *     --mechanism <cpu-starvation|bulk-delete-transaction|disk-full|network-partition|application-bug> \
 *     --trigger <manual-admin-action|scheduled-retention-job|traffic-spike|unknown> \
 *     --first-action <restart-primary|stop-replica|terminate-application-writes|cancel-offending-transaction>
 *
 * Posts to the primary service's :8081/diagnosis intake endpoint (overridable
 * via DIAGNOSIS_URL, which local/docker-compose.yml sets for this container).
 * This script is the whole of what the workstation image carries: it submits
 * four fields the participant chose and prints the verdict back. It holds no
 * grading logic and no answer — nothing here could not also be typed by hand
 * with `curl`. The grader itself lives only in the primary image (see
 * local/Dockerfile's banner).
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pid = Number.parseInt(args.pid ?? "", 10);

const body = {
  offendingPid: Number.isInteger(pid) ? pid : null,
  mechanism: args.mechanism ?? null,
  triggerSource: args.trigger ?? null,
  firstAction: args["first-action"] ?? null,
};

const DIAGNOSIS_URL = process.env.DIAGNOSIS_URL ?? "http://primary:8081/diagnosis";

try {
  const res = await fetch(DIAGNOSIS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  process.exit(json.correct ? 0 : 1);
} catch (err) {
  console.error("failed to submit diagnosis:", err?.message ?? err);
  process.exit(2);
}
