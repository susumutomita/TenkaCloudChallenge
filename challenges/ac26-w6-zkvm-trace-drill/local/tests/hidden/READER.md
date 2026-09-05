# Participant-only reader and runtime evidence — 2026-09-05

An independent agent read only the Japanese statement, the 24 hints, the editor
starter and the deployment's public Inspect values. It used junior-high mathematics
and beginner Python knowledge, did not run code, and did not read the fixture generator,
reference solution or grader. This is an agent read-through, not a human event playtest.

## First pass and repairs

The reader hand-computed all eight answers but found three gaps:

1. The statement moved from taking a remainder after every addition to `full % m`
   without saying why they agree. It now explains that each reduction removes a
   multiple of m, with 10 → 2 in the one-digit example.
2. The ordinary interactive Python route did not mention the blank line ending a
   `for` body. Both languages now explain it, and the actual code blocks include it.
3. The first packet contained the public evidence JSON rather than the actual Inspect
   rendering. The reader correctly treated copyability as unverified. The final packet
   used actual `/api/inspect` output, and the statement identifies the copy range from
   `m =` through the last assignment (now `other_limit =`), excluding the surrounding explanations.

The second read confirmed these three repairs and retained the same eight answers.
The reader also suggested defining `raw` at first use; it now says the sum before
keeping the remainder. No additional calculation is hidden in the hints.

## Independent arithmetic

The synthetic local fixture used m=8, limit=5 and discounts=[6,2,2]. The reader added
6+2+2=10 and followed stored values 6 → 0 → 2. The individual raw sums are 6, 8, 2,
so only the second addition overflows. The machine approves 2<=5, but 10>5.

| Case | Ordinary sum | Machine sum | Improper approval |
| --- | ---: | ---: | --- |
| [1,3,0] | 4 | 4 | False |
| [2,4,0] | 6 | 6 | False |
| [7,7,0] | 14 | 6 | False |
| [7,1,0] | 8 | 0 | True |

The second and third cases refute the incomplete condition that checks only excess.
Reports [True,True,False,True] match recomputation only in the last two positions.
The closing row was subsequently redesigned after PR review found that all eight
rows could be completed by copying. The first seven retain worked code; the last
now requires a constructed input and accepts any candidate meeting its conditions.

The same independent reader received the revised participant-only packet. For m=8,
requested limit 5 and other limit 6, it selected stored value 6, then ordinary total
8+6=14, and constructed [7,6,1]. Each input is in range; 14 exceeds 6; stored 6 is
rejected by the requested program and improperly accepted by the other program.
The reader independently proposed `return [m-1, other_limit, 1]` for the editor.
It asked for the parameter guarantee to be explicit; the statement and starter now
state `0 <= limit < other_limit < m`.

| Field | Independent answer |
| --- | --- |
| exact | 10 |
| trace | [6,0,2] |
| overflow | [False,True,False] |
| decision | (True,False) |
| exploit | [False,False,False,True] |
| predicate | [False,True,True,False] |
| tamper | [False,False,True,True] |
| binding | [7,6,1] (one valid constructed input) |

## Runtime boundary

The author separately submitted these hand answers through actual Docker Workbench
`/api/prepare` and `/verify`: 8/8 accepted. Eight wrong answers and eight unprepared
submissions were rejected. Both Japanese and English code blocks, copied into the
actual `/api/starter` functions, passed rows 1–7 but left the construction failing.
Adding the reader-authored construction made `/api/test` pass in both languages.
Additional valid triples [7,7,0] and [0,7,7] were accepted; inputs accepted by both
programs, rejected by both, or outside the allowed range were rejected. An unfilled
starter failed.
Learner code saw neither `FLAG_SEED` nor the fixture generator module.

The initial CLI run exposed a Docker VM host-mount limitation: the starter directory
was empty inside the container. The CLI now streams the edited file over stdin and
builds the Compose workbench image it actually runs. It requires no host Python or
shared filesystem path. `make inspect`, `make test` with the starter filled from the
visible Japanese rows plus the reader-authored construction, and
`make test-one ID=exact` passed after the repair. The
unfilled starter still failed the public examples. This change is confined to this problem.

Catalog checks do not prove Portal rendering. These runs verify the real participant
editor/Inspect/prepare/verify APIs and CLI, not a deployed Portal, an AWS event, or a
human playtest. No production deployment was performed.
