# Alignment record — the weeks that were not published

Three weeks of the Advanced Cryptography Program 2026 had no material when this
companion track was authored. This file records what was actually checked, what
each companion for those weeks stands on instead, and what a future author must
do when the material appears.

It exists because the alternative — leaving the decision until the course
publishes — makes the record hostage to somebody else's schedule. The companions
were built and shipped regardless, so the reasoning behind them should be written
down while it is still true, not when it is convenient.

Policy is [`GOVERNANCE.md`](./GOVERNANCE.md). The drift procedure is
[`SYNC.md`](./SYNC.md). The week-by-week mapping is
[`curriculum.md`](./curriculum.md). This file is narrower than all three: it
answers one question per companion — *on what basis does this exist, given that
the week it accompanies is empty?*

## What was checked, and how

| | |
| --- | --- |
| Source repository | `zk-tokyo/advanced-cryptography-2026` (public) |
| Commit checked | `a3aa4b56fa88fbe803b57d320fbc87c1a203b480` |
| Checked on | 2026-08-09 |
| Method | Repository tree read at that commit; recorded in `GOVERNANCE.md` §1 and `SYNC.md` §2 |

State at that commit:

- **Week 2** — `week2/README.md` says materials are in preparation. `week2/problems/`
  holds only `.gitkeep`.
- **Week 4** — same shape as Week 2.
- **Week 7** — no directory at all.

Every companion for those weeks pins that state rather than pretending to material:
Weeks 2 and 4 pin their placeholder `README.md` with `kind: "placeholder"`, Week 7
pins the repository `README.md` with `kind: "roadmap"` because there was no path to
pin. `bun run course:drift` reports `PUBLISHED` rather than `DRIFT` when one of
those pins moves, precisely so that this case is distinguishable from ordinary
upstream churn.

**This record is not a claim about the state today.** It is a claim about the state
at that commit, on that date, by that method. Nothing here should be read as
"Week 2 is still unpublished".

## The rule these companions live under

> A problem may not call itself an `assignment-companion` while the assignment it
> claims to accompany does not exist publicly.

The reason is what a reader takes from the word. `assignment-companion` says *there
is an official assignment, and this accompanies it* — a correspondence somebody
could go and check. For an unpublished week there is nothing on the other side of
that claim.

This is enforced, not merely stated:
[`scripts/course-alignment-basis.test.ts`](../../../scripts/course-alignment-basis.test.ts)
fails the build if a problem whose every pin records an absence claims that role.
The guard keys on the pin's `kind`, not on the week number, so it stops applying by
itself the moment an author repins to real material — a rule that needs a human to
remember to relax it eventually gets relaxed for the wrong reason.

## Week 2 — MPC

**Basis: derived from a published week, not guessed from an unpublished one.**

Week 6's `co-snark-prove` is published, and it is downstream of Week 2. Reading it
pins what an MPC prerequisite has to supply, without reading Week 2 at all:

- additive share and reconstruct
- addition and public-constant multiplication on shares
- secret × secret multiplication
- Beaver triples
- the split between local operations and communication rounds
- the allowed open set
- the privacy boundary that forbids reconstructing the witness partway through

That list is a consequence of published material. It would not change if Week 2
published tomorrow with a different emphasis — a learner still needs those things
to reach Week 6.

| problem | role | basis |
| --- | --- | --- |
| `ac26-w2-secret-sharing` | `mechanism` | share/reconstruct, required by `co-snark-prove` |
| `ac26-w2-linear-shares` | `mechanism` | linear operations on shares, required by `co-snark-prove` |
| `ac26-w2-beaver-mul` | `mechanism` | Beaver triples, named directly by `co-snark-prove` |
| `ac26-w2-privacy-audit` | `transfer` | the privacy boundary, applied to a case Week 6 does not cover |
| `ac26-w2-private-aggregate` | `synthesis` | the five above, composed |

None claims `assignment-companion`, and the guard keeps it that way.

## Week 4 — proof systems

**Basis: the gap between two published weeks.**

Week 1 (constraint systems) and Week 6 (zkVM, co-SNARK) are both published. The
proof-system layer between them is what a learner has to cross to get from one to
the other, and its shape is fixed by its two endpoints rather than by Week 4's
eventual contents.

These companions are therefore all `transfer`: they carry a published idea into a
new setting, rather than accompanying an assignment.

| problem | role | basis |
| --- | --- | --- |
| `ac26-w4-arithmetization` | `transfer` | Week 1's constraints, carried to trace and polynomial form |
| `ac26-w4-commit-open` | `transfer` | commit → challenge → open, the transcript Week 6 assumes |
| `ac26-w4-proof-pipeline` | `transfer` | the layers end to end, as a map rather than an implementation |

### What is deliberately not decided here

`SNARK` and `STARK` name families, not properties. Nothing in these companions
asserts which one Week 4 will teach, and no security property is claimed from a
name. The layers are kept separate on purpose — computation and statement and
witness; arithmetization; trace and polynomial representation; commitment;
interactive challenge and Fiat–Shamir; opening and query; low-degree and relation
checks; verifier checks; setup; assumptions; complexity; the zero-knowledge
mechanism — so that when Week 4 publishes, the mapping is a matter of matching
layers rather than rewriting the problems.

### Boundary with Week 3

Week 3 is published and owns the group and field mechanics (`ac26-w3-field-inverse`,
`ac26-w3-ec-group`, `ac26-w3-schnorr`, `ac26-w3-nonce-reuse`). Week 4's companions
do not re-teach those; they assume them. A reader who finds field arithmetic being
explained in a Week 4 problem has found a boundary violation.

## Week 7 — capstone

**Basis: independent synthesis, and stated as such.**

Week 7 has no directory upstream, so there is nothing to accompany. The two
capstone problems are an independent synthesis of Weeks 1–6, pinned to the
repository roadmap because that is the only citable artifact.

| problem | role | basis |
| --- | --- | --- |
| `ac26-w7-capstone-design` | `synthesis` | threat model, primitive selection, typed architecture, experiment plan |
| `ac26-w7-capstone-demo` | `synthesis` | reproducible prototype, adversarial tests, evidence bundle |

They claim no official evaluation, no endorsement, and no correspondence with a
Demo Day submission format. Their exports are a generic evidence bundle rather
than anything shaped to an unpublished rubric.

## When the material appears

Do not reopen the issues that produced this record (#219, #229, #245). They
recorded a decision, and the decision was correct for the evidence available.

Open a new source-drift issue instead — `bun run course:drift` will have reported
`PUBLISHED` for the moved pin, which is the trigger. That issue does the work this
one could not:

1. Pin the real commit SHA. Read `week<N>/README.md` and every
   `week<N>/problems/**/README.md`, plus templates, public tests, and CI.
2. Separate what the official material's stated goals are from what its tests
   actually measure.
3. Compare against the companions above: overlap, gaps, and terminology or
   notation conflicts.
4. Decide whether any companion has become a genuine `assignment-companion`. The
   guard stops applying automatically once the pin moves, so this is a real
   decision rather than a formality.
5. Update `curriculum.md`'s week row and this file's basis table.
6. Check that no official answer, fixture, or hidden test has leaked into a
   companion — `spoilerPolicy: independent-reimplementation` (GOVERNANCE.md §3)
   does not weaken because the material became available.

Points 1 and 6 are the ones worth being slow about. An invented SHA is worse than
no pin (GOVERNANCE.md §5), and a companion that starts quoting the official
solution stops being a companion.
