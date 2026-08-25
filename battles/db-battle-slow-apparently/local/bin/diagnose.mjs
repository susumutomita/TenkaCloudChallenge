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
 * Posts straight to this same container's own loopback :8081/diagnosis —
 * nothing the grader could not also verify independently later; this is
 * just the intake form. See local/grader/grade.mjs for how it is graded.
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

try {
  const res = await fetch("http://127.0.0.1:8081/diagnosis", {
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
