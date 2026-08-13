# Challenge playability merge policy

This policy applies when a pull request adds a directory under `challenges/` or
`battles/`, or promotes an existing problem from a non-ready status to
`status: ready`, or adds `scripts/<problem-id>.test.ts` under a matching
`feat(<problem-id>):` / `test(<problem-id>):` title before metadata exists.

Repository CI, mutation tests, reference runs and runtime tests remain required,
but they are not a substitute for a participant actually solving the problem.
The `playability-gate` check therefore requires all of the following:

1. the pull request is no longer Draft;
2. a human maintainer has applied the `playtest-verified` label after reviewing
   the evidence;
3. the PR body contains exactly one machine-readable evidence block;
4. every affected problem records a blind play, failing starter, passing
   solution, deterministic negative cases, cleanup, and a repository Issue/PR
   comment URL containing the non-secret evidence.

Use this block in the PR body. Do not include flags, reference solutions, hidden
verifier inputs, credentials, or cloud account identifiers.

```markdown
<!-- tenkacloud-playability-v1
{
  "schemaVersion": 1,
  "problems": [
    {
      "id": "problem-id",
      "tester": "@github-handle",
      "completedAt": "2026-08-12T12:00:00Z",
      "blind": true,
      "starterFailed": true,
      "solutionPassed": true,
      "negativeCasesPassed": true,
      "cleanupPassed": true,
      "evidenceUrl": "https://github.com/susumutomita/TenkaCloudChallenge/issues/123#issuecomment-456"
    }
  ]
}
-->
```

The linked comment should state the tested commit, runtime/architecture, clean
start command, time to first score and completion, checks attempted, final
score, cleanup result, and any unresolved observation. It must not publish
solution material.

## Required GitHub ruleset

A repository administrator must configure `main` with all of these settings:

- require the `playability-gate` status check before merge;
- require the existing aggregate CI, simulator compatibility, course drift, and
  security checks;
- do not allow GitHub Apps, administrators, or merge automation to bypass those
  required checks;
- restrict application/removal of `playtest-verified` to human maintainers;
- require a separate human approval for changes to
  `.github/workflows/playability-gate.yml`,
  `scripts/check-pr-playability.ts`, its tests, and this policy.

After applying the ruleset, verify it with two disposable PRs:

- a Draft/RED-only new-problem fixture must remain unmergeable;
- a complete fixture must remain unmergeable until evidence is valid, the PR is
  ready for review, and a human applies `playtest-verified`.

Record the ruleset URL and both PR/check URLs on Issue #463. Source changes alone
do not complete that Issue because repository settings are an external trust
boundary.
