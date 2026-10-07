# Local verification evidence — 2026-10-07

Environment: macOS arm64, Bun 1.3.11, TypeScript 5.9.3, playwright-core 1.58.2 with already installed Chromium. Worktree based on TenkaCloudChallenge `aeacd121`; all changes are confined to this problem directory. Existing checkout modifications were preserved.

| Command / review | Observed result | Boundary |
| --- | --- | --- |
| `make test` | 18 tests pass, 0 fail, 583 assertions | Pure game, arithmetic, local HTTP and package placement/style behavior |
| `make typecheck` | Pass | Narrow Portal type contract, not native loading |
| `make reference-test` | Independent Fraction/Machin checks, candidate enumeration and finite Lemma 4.1 parameters pass | No infinite theorem |
| `make browser-test` | Two isolated browser contexts; four rounds, eight claims; final blue 1 / orange 27; no page errors | Real Portal component and local server, not authentication |
| Root `make install` + `make agent-gate` | All 126 existing metadata files valid | Prototype deliberately has no metadata registration |
| Independent mathematical review | Real defects caught and repaired; final arithmetic/explanation check passed, with final β wording clarified | No full Lean build or independent human playtest |

The browser script only plays through visible inputs. It tests free rules and hints, an initially private 355/113 trial, reload recovery, three concrete mathematical audits and one scope audit, the types/degrees in a mixed arrangement, and the final explanation. To test an uncertain network outcome it lets the server accept an upgrade, drops its response, then presses the visible retry button: the two submitted bodies match and exactly one ticket is consumed. The script does not seed private state, read a solution oracle, or bypass player controls to play moves.

Screenshots are generated under ignored `reports/browser/`: `round-3-desktop.png`, `debrief-desktop.png`, `debrief-mobile.png`. Desktop and 390px mobile output were visually inspected; the browser also asserts no horizontal overflow. Re-run the script to reproduce them.

Not run: native TenkaCloud host registration/loading, event authentication, official scoring delivery, durable storage, AWS deployment, an independent human usability trial, full Lean dependency build, axiom audit or Comparator. No merge, release or cloud resource was performed.

## PR900 follow-up

The original head `2095033c` passed catalog CI, GitGuardian and Snyk; capacity was skipped. GitHub submitted reviews, conversation comments, inline comments and head commit comments were empty. That green did not run this prototype's own tests. A dedicated workflow now runs them plus the real two-seat browser match; report its result against the updated head rather than treating the old catalog green as prototype evidence.

Actual TenkaCloud `hostBrowserProblemPaths` was called against a temporary `problems` symlink to this worktree. Before the fix it reproduced ENOENT on `battles/pi-siege/metadata.json`. After moving to non-catalog `battles/_pi-siege`, the same function read all 109 existing public paths, excluded the prototype and did not throw. A layout regression test protects that identity boundary.

The coordination file now follows the required `coordination/<name>.ts` shape and is what the dev server invokes. The Portal imports its own CSS, whose global root/body rules were removed to avoid altering a native Portal shell. Updated browser assertions also verify that the first screen distinguishes player audits from finding manuscript errors, and the debrief says audits do not refute the research theorem. Native host gameplay remains unimplemented; [INTEGRATION.ja.md](INTEGRATION.ja.md) records concrete owners, paths and completion checks.
