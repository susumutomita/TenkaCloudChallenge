# Governance — Advanced Cryptography 2026 companion track

Reuse, attribution, spoiler, and synchronization rules for the TenkaCloud
challenges that accompany the Advanced Cryptography Program 2026.

This document is the authority for what companion content may and may not do.
The curriculum mapping itself lives in [`curriculum.md`](./curriculum.md).

| Field | Value |
| --- | --- |
| Relationship | `independent-companion` |
| Decision date | 2026-07-25 |
| Decided by | TenkaCloud maintainers |
| Source repository | `zk-tokyo/advanced-cryptography-2026` |
| Source visibility | Public |
| Source licence | **None found** |
| Reuse rule | `independent-reimplementation` |
| Review date | 2026-08-15 |

## 1. Relationship: `independent-companion`

TenkaCloud's Advanced Cryptography 2026 track is an **independent, unofficial**
companion. It is not endorsed, reviewed, or co-maintained by the course
organizers.

### Evidence for this classification

Checked on 2026-07-25 against `zk-tokyo/advanced-cryptography-2026` at commit
`5e80999306608a45aecf9a0e4e3394a0b62f34d2`:

- the repository is public;
- the GitHub repository metadata reports no licence (`licenseInfo` is null);
- the repository tree contains no `LICENSE`, `LICENSE.md`, `COPYING`, or
  equivalent file at any path;
- the root `README.md` describes enrolment, forking, and submission mechanics
  only. It grants no reuse rights and names no reuse terms.

No explicit permission has been requested from or granted by the course
organizers, and none is assumed.

### What follows from it

Because no licence grant exists, the default of copyright applies: the course
materials are all-rights-reserved from TenkaCloud's point of view. Therefore:

1. TenkaCloud does **not** describe this track as official, endorsed, approved,
   or affiliated.
2. TenkaCloud does **not** copy the course's prose, code, templates, tests,
   fixtures, or diagrams.
3. TenkaCloud references the course only by repository path and commit SHA, as a
   pointer for learners who are already enrolled.
4. Mathematical concepts, protocol names, and publicly stated learning goals are
   not copyrightable subject matter and may be taught in TenkaCloud's own words
   and its own code.

### Changing this classification

If the organizers later grant permission, do **not** edit this decision in
place and do not reopen the issue that produced it. Open a new, bounded
governance-change issue that records the grant, its scope, and who gave it, and
supersede this file from there. A decision record that is silently rewritten
stops being evidence.

## 2. Reuse matrix

Applies to every artifact under `zk-tokyo/advanced-cryptography-2026`.

| Source material | Copy | Modify and ship | What TenkaCloud does instead |
| --- | --- | --- | --- |
| Week / problem `README` prose | No | No | Write the scenario independently |
| `template/solution.py` skeletons | No | No | Define an unrelated API surface |
| Public tests (`tests/public.py`) | No | No | Generate cases from a hidden seed |
| Hidden tests, reference solutions | No | No | Never accessed or reproduced |
| Slides (`week0/slide.pdf`) | No | No | Draw original diagrams |
| Problem names (`proof-of-exploit`) | Reference only | No | Cite as an alignment pointer |
| Mathematical concepts, protocol names | n/a | Yes | Teach in TenkaCloud's own words |
| Publicly stated weekly learning goals | Paraphrase | Yes | Restate as TenkaCloud objectives |

"Reference only" means the name may appear in metadata and in maintainer-facing
documentation to say *which* official exercise a challenge sits beside. It must
not appear as reproduced problem content.

### The independent-reimplementation rule

Every companion challenge must satisfy all of the following:

- its scenario, framing, and narrative are written from scratch;
- its function and file names differ from the official skeleton's;
- its fixtures are generated from a seed the author controls, not copied;
- its parameters (field moduli, curve orders, sharing thresholds, noise bounds)
  are chosen independently;
- it can be solved without ever opening the official exercise, and solving it
  does not hand over the official exercise's answer.

An author who cannot meet these without looking at the official solution should
not ship the challenge.

## 3. Spoiler and embargo policy

The course grades its own submissions. A companion track that leaks answers
damages the learner it is meant to help, so publication is staged.

| Companion content | May be published |
| --- | --- |
| `diagnostic` (prerequisite check) | Any time — assumes no lecture content |
| `mechanism` (internals experiment) | After that week's lecture is public |
| `assignment-companion` | After that week's lecture is public |
| `transfer` (different setting) | After that week's lecture is public |
| `synthesis` (multi-week) | After the last contributing week is public |
| Writeups and full walkthroughs | Any time — for the TenkaCloud challenge only |

Two rules bind regardless of timing:

1. **No official-answer hints.** A hint must never state, in any form, what to
   write in the official exercise's blanks. Hints explain the *mechanism* using
   TenkaCloud's own construction.
2. **No official-fixture leakage.** A writeup must never print an official test
   vector, expected output, or parameter set.

TenkaCloud writeups explain the TenkaCloud challenge. They are not solutions to
the course, and reviewers reject any writeup that would function as one.

`metadata.json` records the intent of each challenge in
`courseAlignment.spoilerPolicy`. Its values are defined in `SCHEMA.json`:

| Value | Meaning |
| --- | --- |
| `public-reference` | Cites the source only; contains nothing derived from it |
| `independent-reimplementation` | Same concept, independently built — the default |
| `approved-derivative` | Derived under an explicit, recorded grant |
| `embargoed` | Must not be shown to participants yet |

Under the current `independent-companion` classification,
`approved-derivative` is **not available**: no grant exists to derive under.
Authoring tooling rejects it until a governance-change record introduces one.

## 4. Attribution and naming

### Required disclaimer

Every participant-facing surface that names the course carries this text, in the
participant's language:

> TenkaCloud のこのトラックは Advanced Cryptography Program 2026 の学習者向けに
> 独立して作られた非公式の補助教材です。講座運営とは無関係で、公式教材の解答は
> 含みません。

> This TenkaCloud track is an unofficial companion built independently for
> learners of the Advanced Cryptography Program 2026. It is not affiliated with
> the course organizers and contains no official assignment solutions.

### Naming rules

- Refer to the course by its public name, to identify what the track accompanies.
- Never use the organizer's logo or visual identity.
- Never use "official", "endorsed", "approved", "partner", or "certified".
- Never imply that completing TenkaCloud challenges counts toward course credit.

### Contact

Questions, corrections, and takedown requests: open an issue on
[TenkaCloudChallenge](https://github.com/susumutomita/TenkaCloudChallenge/issues).
A removal request from the course organizers is honoured without argument — the
material is a courtesy to their learners, not a claim on their work.

## 5. Source pinning and drift

The course repository is actively developed; several weeks were unpublished when
this track was designed. Alignment must therefore be pinned, never floating.

1. Every `courseAlignment.sources[]` entry records a repository, a **40-hex
   commit SHA**, a path, and a kind. `SCHEMA.json` rejects a branch or tag name
   in place of a SHA, so alignment can never silently follow upstream `main`.
2. Upstream changes are never merged automatically. The drift check reports what
   moved; a human decides what it means.
3. When drift is reported, a maintainer re-reads the changed source and either
   re-pins the SHA (if the alignment still holds) or files an issue (if the
   exercise was revised, retired, or replaced).
4. A pin is not a claim that TenkaCloud content was derived from that commit. It
   records which version of the course the alignment was checked against.
5. A week that was unpublished when its companion was authored is pinned with
   `kind: "placeholder"`, so that when the material appears the check reports a
   publication rather than an edit. Reading new material can mean re-scoping the
   companion, not just moving the SHA.

Run the drift check with `bun run course:drift`. The operating procedure — how to
read each marker, when the check runs, and how a pin is moved — is
[`SYNC.md`](./SYNC.md).

## 6. Open items

| Item | Status as of 2026-07-25 |
| --- | --- |
| Week 2 (MPC) | Unpublished upstream — `week2/README.md` says materials are in preparation; `week2/problems/` holds only `.gitkeep` |
| Week 4 (ZKP) | Unpublished upstream — same state as Week 2 |
| Week 7 (Demo Day) | No `week7/` directory exists upstream |
| `week0/slide.pdf` | Present upstream, referenced by no week README. Treated as out of scope for the seven-week mapping |
| Organizer contact | Not established. No permission requested or granted |

Companion content for an unpublished week is authored as `diagnostic` or
`transfer` from publicly stated themes only, and never asserts what the official
exercise will require.
