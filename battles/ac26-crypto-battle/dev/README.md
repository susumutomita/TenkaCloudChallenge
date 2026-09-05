# Local development harness — ac26-crypto-battle

Runs this Battle's **real** game model and **real** Portal components in a
browser on your machine. No AWS account, no credentials, no deploy.

It exists for one reason: before it, checking whether an Order card lined up or
a LEAK animation read correctly meant a full deploy into a real event. Now it is
a reload.

```bash
cd battles/ac26-crypto-battle/dev
bun install
bun run dev          # http://localhost:5644  (PORT=... to change)
```

`bun install` inside `../game` is **not** required — this directory carries its
own dependencies.

## This is not the competition's trust boundary

Read this before quoting anything you see here.

- **No authentication.** The seat selector switches between `alpha` and `bravo`
  with no credential at all. The real Portal resolves a team from a login key;
  this does not.
- **State is local and visible.** The match lives in one Bun process's memory.
  Whoever runs the server can read every team's secret straight out of it.
- **No score here is official.** Nothing is persisted, ranked, or reported.
- **It is not the trusted verifier.** The verdicts you see come from the same
  reducer the platform runs, but running it locally proves nothing about the
  platform's own auth, tenant isolation, persistence, or deployment.
- **Playability evidence stays participant-shaped.** Per this repository's
  AGENTS.md §12c, use only what a participant can see. This harness renders the
  real components and drives participant-visible inputs, so it is valid release
  evidence for the Battle UI and moves. It does not prove platform auth, tenant
  isolation, persistence, or deployment. A live-AWS run may rehearse those
  platform concerns before an event, but it is not a merge gate.

## What is real, and what is faked

| Real (unmodified) | Faked (this directory) |
| --- | --- |
| `../game/src/reducer.ts` — every rule, score, and verdict | the HTTP dispatcher |
| `../game/src/shamir.ts`, `sudoku.ts`, `field.ts` | in-memory state, no DynamoDB / Turso |
| `../game/src/playtest.ts`'s op builders (scenario setup) | `PortalSlotProps` — team, endpoints, phases |
| `../portal/*.tsx` — all three declared slots, plus their imports | authentication and tenant isolation |
| the optimistic-lock version and tick-before-op ordering | the tick cadence (the clock is yours to drive) |

No game logic is re-implemented here. `host.ts` is the whole platform-shaped
part, and it is about forty lines of plumbing around
`initialState` / `validateOp` / `applyOp` / `tick` / `projectForTeam`.

It calls those five hooks directly rather than importing
`../coordination/crypto-battle.ts`, because that file is compiled against
`@tenkacloud/coordination-plugin-sdk` — which exists in this repository only as
a types-only ambient declaration, and which this repository's AGENTS.md
"Repository boundary" forbids depending on for real. The wrapper itself is a
six-line passthrough already covered by
`../game/src/coordination-plugin.test.ts`.

## The toolbar

| Control | What it does |
| --- | --- |
| **scenario** | Jumps to a deterministic position (below). |
| **seat** | Which team's Vault and Orders you are looking at. |
| **locale** | `ja` / `en`, the same prop the Portal passes its slots. |
| **clock** | `+30s` / `+1m` / `+5m` step the match clock; `▶ run` makes it live. |

The clock is **paused by default**, so a scenario looks the same every time you
load it. Press `▶ run` to watch countdowns and phase transitions move.

## Scenarios

Every one is reached by replaying **real ops through the real reducer** — never
by hand-assembling a state. A hand-built state can express a position the rules
cannot produce, and then the UI gets tuned against a board that will never
appear. If the rules cannot reach a position, `scenarios.ts` throws instead of
faking it.

| Scenario | Position |
| --- | --- |
| `fresh` | Match just started, first Orders issued, empty Ledger. |
| `ledger-filling` | A LEAKed share and a PROVE transcript side by side. |
| `hunt-reachable` | `alpha` has leaked threshold-many distinct shares of its current generation. |
| `after-rotate` | `bravo` landed a HUNT, then `alpha` re-keyed — generation 2, penalty applied. |
| `ended` | Match over; every op is rejected and the surface is read-only. |

`hunt-reachable` is a **developer's** label. The participant UI still must never
announce "you can hunt now" — that rule (Issue #486, restated in #646's
non-goals) is unchanged, and the check that builds this scenario lives in
`scenarios.ts`, never in a panel.

## Checks

```bash
bun test         # harness invariants (see harness.test.ts)
bun run typecheck
```

`harness.test.ts` pins the properties that make the preview worth trusting: the
read path *is* `projectForTeam`; ops the reducer rejects are rejected here too;
scenarios rebuild byte-identically; and no seat's payload carries the opponent's
secret or un-leaked shares, even though there is no authentication in front of
it.

The game's own suite stays where it belongs:

```bash
cd ../game && bun test && bun run typecheck
```

## Cost

None. Nothing in this directory contacts AWS or creates a cloud resource.
