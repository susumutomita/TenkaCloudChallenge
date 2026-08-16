# Sync runbook — Advanced Cryptography 2026 companion track

How to keep this track's alignment honest while the course it accompanies is still
being written. The policy behind it is [`GOVERNANCE.md`](./GOVERNANCE.md) §5; this
file is the operating procedure.

The rule the whole runbook exists to protect: **upstream is never merged, only
read.** The checker reports what moved. A human decides what it means.

## 1. What is watched

Only what a problem's metadata declares. `bun run course:drift` collects every
`courseAlignment.sources[]` entry across `challenges/*/metadata.json` and
`battles/*/metadata.json`, then compares each pinned path's blob at its pinned
40-hex SHA against the same path on the source repository's default branch.

Nothing else is watched. A course file no challenge points at is invisible to the
checker — which is the intent: the pin list is the record of what somebody
actually read, so a path nobody pinned has no alignment to lose.

The consequence worth knowing: **a problem without a pin is invisible to this
check** — and that is sometimes correct. `challenges/ac26-bridge-experiment` omits
`sources` on purpose: it gates Week 1 rather than accompanying any specific
material, and the only citable upstream artifact would be `week0/slide.pdf`, which
`curriculum.md` records as out of scope. Omission with a stated reason is an
answer; an invented SHA is not.

What keeps an unpinned problem accountable is `curriculum.md`'s "Maintenance"
section: a problem whose week has no row there is an unmapped problem.

As of 2026-08-16 the catalog carries **63 pins** across the Advanced Cryptography
track, so `bun run course:drift` does real work on every pull request that
touches a `metadata.json`, the checker, or its workflow.

The check has fired in anger twice. On 2026-08-09 it reported seven `DRIFT` rows
and five `PUBLISHED` rows; the drift turned out to be a lecture-slide link added
to the Week 1 and Week 3 READMEs, and the publication was Week 2's material
arriving. See `curriculum.md`'s Week 2 section for what the reading found — the
SHA bump was the easy half.

On 2026-08-15 it reported `DRIFT` on every Week 3 `slide` pin after upstream
`b1b4666` rewrote `week3/week3_zksnark_slides.pdf`. Reading both decks page by
page found a reorganisation and no revision: the extended-Euclid and
Fourier-inversion slides moved from the main deck into the appendix with their
bodies unchanged, and the `対話 ZK/FS` section moved to sit after
`Arithmetization`. What arrived is new material rather than replacement — a
Fiat–Shamir security caveat, an arithmetization comparison slide, a smaller
group-work sudoku. No statement the
six companions rely on was revised or retired, so the pins moved and the problems
did not. The reading is recorded in #482.

## 2. Unpublished weeks

Week 2 and Week 4 both shipped a README saying materials are in preparation, with
`problems/` holding only `.gitkeep`. Week 7 has no directory at all. Week 2's
material was published on 2026-08-09 and its companions now pin the real thing;
Week 4 is still in the placeholder state, and is the live example below.

Companion challenges for such weeks pin the placeholder itself, with
`kind: "placeholder"`:

```json
{
  "repository": "zk-tokyo/advanced-cryptography-2026",
  "ref": "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
  "path": "week4/README.md",
  "kind": "placeholder"
}
```

This records a fact rather than a guess: *at this commit, this week had no
material, and the companion was authored from the publicly stated theme alone.*

When the pin moves, the checker reports `PUBLISHED` rather than `DRIFT`, because
the two need different responses (§3). Week 7 has no path to pin; its capstone
challenges pin the repository `README.md` as `kind: "roadmap"` instead, and the
roadmap changing is ordinary drift.

## 3. Reading the report

`bun run course:drift` prints one block per actionable pin and a summary line.

| Marker | Meaning | Response |
| --- | --- | --- |
| `PUBLISHED` | A `placeholder` pin moved — material that did not exist when the companion was authored now exists | **Read the new material first.** The companion was scoped against a theme, so the honest outcome may be re-scoping it, splitting it, or retiring it — not re-pinning. Open an issue describing what the official exercise now requires, and only then decide the pin |
| `DRIFT` | A published source's content changed | Re-read the changed file. Either re-pin the SHA (the alignment still holds) or open an issue (the exercise was revised) |
| `REMOVED` | The path no longer exists upstream | Find out whether it was renamed or retired. Never leave a challenge pointing at a path that is gone — either re-point it or drop the source entry |
| `UNKNOWN` | Neither side could be resolved | Usually a rate limit or a network failure. Re-run. A pinned SHA that genuinely stopped serving a path means upstream history was rewritten — treat that as a governance question, not a pin update |
| *(summary only)* | `in sync` | Nothing to do |

Exit codes: `0` nothing actionable, `1` at least one `PUBLISHED` / `DRIFT` /
`REMOVED`, `2` the source repository could not be reached at all. Offline it exits
`2` rather than reporting a clean run.

`--json` emits the same rows machine-readably; `--no-fail` reports without the
non-zero exit, for a run whose output is being read by a person rather than gating
a pull request.

## 4. When it runs

| Trigger | Cadence | Why |
| --- | --- | --- |
| `schedule` | Mondays 01:23 UTC | Offset from `submodule-sync` so the two never contend |
| `pull_request` | On changes to any `metadata.json`, the checker, or its workflow | A bad SHA is caught in review, not by next week's run |
| `workflow_dispatch` | On demand | For checking right after a lecture |

The workflow holds `permissions: contents: read` and **files no issues**. It
writes its report to the job summary; a human opens the issue if one is needed.
That is deliberate: an auto-filed issue on every upstream commit would train
everyone to close them unread, and closing a drift report unread is exactly the
failure this check exists to prevent.

During the course, raise the schedule to daily if a week's publication needs to be
noticed within a day. After the course ends, drop it or remove the schedule
entirely — a finished edition stops drifting.

## 5. Re-pinning

A pin is updated by hand, in a pull request, by someone who has read the new
content. The pull request body states:

- which pins moved, and from which SHA to which;
- what changed in the material, in a sentence;
- why the alignment still holds — or what was changed in the challenge so that it
  does.

Update `curriculum.md`'s source snapshot in the same pull request when the
track-wide reference commit moves, so the map and the pins never disagree.

Never re-pin to make the check pass. A green drift check whose pins were bumped
without reading anything is worse than a red one: it looks like verification.
