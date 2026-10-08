# Pi Siege — records and guarantees

Two players build records and guarantees, then challenge gaps in each other's published reasoning. Four rounds turn one paper's strategy into finite experiments: rational approximation, a nonzero 2×2 determinant, mixed row arrangements, and simultaneous parameter constraints. Players allocate six action tickets per round to experiments, upgrades, publication and audits. Startup and waiting earn no points.

This is a **Japanese/English native local Battle** when used with the linked TenkaCloud host change. Its metadata, coordination plugin and Portal component are registered at `battles/pi-siege`. See [日本語](README.ja.md), [design](DESIGN.ja.md) and [research/review](RESEARCH.md).

Audits target players' claims in this finite game, not errors in the manuscript. Constructing tools that cover zero, mixed arrangements and both parameter conditions is the experience of the proposed strategy. [Native competition integration and evidence](INTEGRATION.ja.md) describe the coordinated host contract.

## Play in TenkaCloud

Use the linked TenkaCloud host branch and its pinned `problems` revision. Run `make install` and `make local` in TenkaCloud, sign in to the organizer console, select **Pi Siege**, create exactly **two teams**, prepare jobs and start Schedule. Each player signs in at the participant Portal with their own team key and opens Pi Siege. Both press **Ready**. Scores and match state are saved to the host SQLite database; restart with the same host data directory to continue. One coordination Battle is allowed per event. No Docker or AWS is required for this Battle.

## Standalone practice harness

Requires Bun and a browser. The game uses no AWS account, cloud resources, external APIs or paid computation.

```sh
cd battles/pi-siege
make install
make dev
```

Open `http://127.0.0.1:5655/?team=alpha` and `http://127.0.0.1:5655/?team=bravo` in two tabs or profiles. Add `&locale=en` to either URL for English, including rules, hints, calculation feedback and score history. Both players press **準備完了** / **Ready**. First action: keep p=3, q=1 and press **分数を試す**. Its error estimate and comparison with 1/q³ appear. All required rules and worked examples are free, with three free hint levels per round.

Turns alternate after each action; starting seats alternate each round. A player can finish early. Both finishing, or exhausting tickets, settles claims and advances the round. After the fourth settlement, the winner, published reasoning, historical difficulty, manuscript strategy and remaining proof limits appear.

| Round | Choice | Feedback |
| --- | --- | --- |
| Approximation | Enlarge denominator range or save tickets for audits | Error estimate, exact interval comparison, finite versus unsupported infinite claim |
| Integer clearing | Build a small nonzero difference or audit a scale/zero error | Exact determinant, common denominator D and floor 1/D² |
| Mixed arrangements | Buy rows, inspect splits or calculate a counterexample | Cards show type/degree; an audit requires the player's sum |
| Allocation | Buy a finer grid or challenge one failing side | Two entry margins and two δ-adjusted margins in exact fractions |

Publication is once per player per round. A held claim earns +6; successful audit +4 and author −3; failed audit consumes one ticket without changing scores. If both hold, the stronger claim earns +2. Comparison rules are error×q², claimed integer-derived floor, guaranteed k, and the smaller of the **two entry margins**, respectively. Allocation must first pass all four conditions. The table round grades the guarantee from integer clearing, not a stronger bound read directly from the actual difference.

After playing, discuss: four type-0 cards have degrees 0,1,2,3, sum 6. Two of each type have degrees 0,1 and 0,1: type sum 2 plus degree sum 2 gives 4. This disproves “every arrangement has k≥6.” It does not establish that an actual determinant term is nonzero or large.

## Runtime boundaries

`coordination/pi-siege.ts` exposes the existing pure hook shape; `portal/StatusPanel.tsx` is the real Portal slot. The Bun harness composes the same authoritative reducer and component with an injected coordination client. SDK imports are type-only; no platform SDK runtime is bundled. The narrow declaration contract was copied from TenkaCloud `05ffed84`; native integration uses host base `05d29d12`.

The server binds to `127.0.0.1`, checks Host/Origin and bounds operation bodies. Scores, tickets, turns and calculations are server-owned. Unknown fields and stale revisions are rejected. Identical request ID/body retries are idempotent even across rounds; changing that body is rejected. Experiments are private until publication. Row counts are captured with experiments, preventing later upgrades from retroactively strengthening a claim.

The **standalone practice harness** has no authentication: either URL selects a seat, and local reset is available. Use it on one trusted machine. It proves local playability, not the native host's authentication, official scoring or durability. State is in memory and disappears on process exit. Reload both tabs after reset. Stop with Ctrl-C. Resources are local CPU, memory and disk; none continues cloud billing.

The coordinated host uses an explicit reviewed catalog. It authenticates team keys, enforces exactly two teams before event creation/preparation/start, pins the authoritative plugin bundle and stores state and signed score deltas transactionally. The browser includes only the reviewed Portal component, public bilingual content and CSS; reducers, arithmetic grading, development harness and organizer documents stay excluded. The native `local/bun` validator checks the real plugin and Portal references without a Docker verifier or AWS template.

## Verification

```sh
make test typecheck reference-test
make browser-test
BROWSER_LOCALE=en make browser-test
```

The browser test uses `playwright-core` and an already installed matching Chromium; it never downloads a browser. Set `BROWSER_EXECUTABLE` to an installed Chrome/Chromium executable if needed. Screenshots go to ignored `reports/browser-ja/` or `reports/browser-en/`; override with `BROWSER_OUTPUT_DIR`.

The dedicated GitHub Actions workflow explicitly installs pinned Playwright Chromium and Linux dependencies before running the same browser match. The local browser command itself still does not install them.

The automated match drives visible controls in two isolated contexts: four rounds/eight claims, lost response and exact retry, private trial and refresh, a hand-calculated mixed arrangement, settlement/debrief, and mobile width. Unit tests cover exact arithmetic, independent enumeration, hostile inputs, concurrent stale writes, failed/repeated audits, exhaustion, immutability and row snapshots. Bilingual state schema 2 replays the retained schema-1 operations and checks the old structure before accepting migration. Legacy score and mixed-audit fixtures retain signed points, tickets, receipt replay and the numerical counterexample in both languages. Four complete 50-operation storage traces measure every transition with maximum-length IDs and names; their maximum is 55,814 bytes. This is a measured set of supported two-team profiles, not an exhaustive global maximum or native storage test. Independent mathematical review found real defects and verified the repairs; see RESEARCH.md.

Lean dependency build, axiom audit, Comparator execution, native host registration, live AWS and an independent human playtest were not run. Local tests do not verify the manuscript's infinite theorem.

Native verification in the linked TenkaCloud checkout: `bun run test:host:pi-siege`. The browser drives organizer selection and two team-key logins, restarts the host process and browser contexts against the same SQLite data, then finishes all four rounds and checks the official 1–27 ranking, bilingual history and mobile layout. [Evidence](EVIDENCE.md) separates this from the standalone harness and theorem verification.
