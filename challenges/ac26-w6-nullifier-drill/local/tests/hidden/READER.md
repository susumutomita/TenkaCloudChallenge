# Participant-only reader and runtime evidence — 2026-09-06

An independent agent used only the Japanese statement, 24 hints, editor starter and
public Inspect values. It took the role of a reader with junior-high mathematics and
one beginner Python book. It did not execute code or read the generator, reference
solution or grading implementation. This is an agent read-through, not a human event.

## First pass and corrections

The initial read could calculate all eight answers, but found three real gaps:

1. A request was marked verified although its marker could not be produced by the
   stated formula for that election. Fixtures now choose all verified markers from
   the actual formula's output range for that request's scope. The learner's secret
   is 1 through p−1 to ensure a closing collision; other participants may use 0 through
   p−1, which is now stated. The author regression checks every verified fixture.
2. The count hint claimed three records without showing the six requests. Row 4 now
   includes the full one-digit table. Its accepted markers are 5, 3 and 2, each a valid
   output of the toy formula for the stated scope.
3. The scope wording implied every different election has a different marker. It now
   refers to the two supplied elections and explicitly explains that adding p to a
   scope repeats the marker in this tiny model.

The final packet included actual `/api/inspect` output. The reader confirmed each
repair and independently checked the revised verified markers: at p=5, scope=3,
marker 3 can come from secret 0 and marker 4 from secret 1; at scope=4, marker 4 can
come from secret 0. It did not infer real anonymity from this model.

## Independent arithmetic

The reviewed local fixture has p=5, secret=2, scope=3, scope_ids=[3,4] and messages=[1,1].
The marker is (2×2+3) remainder by 5 = 2. Both messages keep that marker. The other
supplied election has marker 3. The deliberately vote-dependent marker is 3 for both
votes, so the flawed design accepts the first and rejects the duplicate.

Requests arrive with (verified, scope, marker):
(False,3,3), (True,3,3), (True,3,3), (True,4,4), (True,3,4), (False,3,2).
Only the second and fifth requests pass all three checks, leaving markers 3 and 4.
The version that skips verification wrongly accepts the first and sixth requests.

| Field | Hand-computed answer |
| --- | --- |
| label | 2 |
| repeat | [2,2] |
| scopes | [2,3] |
| accept | [False,True,False,False,True,False] |
| count | 2 |
| message | [True,False] |
| unchecked | [True,False,False,False,False,True] |
| collision | 3 |

For the last row, the reader independently constructed secret 3: 3×3+3=12 has
remainder 2, the same marker as secret 2. It independently proposed `return p-secret`
under the stated prime/nonzero domain. The published statement does not provide a
completed implementation for that final construction.

## Actual participant runtime

The author submitted the hand answers through real Docker Workbench `/api/prepare`
and `/verify`: 8/8 accepted; eight wrong and eight unprepared submissions rejected.
Both languages' seven code blocks copied into the real `/api/starter` passed the
teaching rows but left `collision` unfinished. Adding the reader-authored construction
made `/api/test` pass. Learner execution could see neither the fixture seed nor the
generator. An actual Inspect run caught a missing import path in show.py; it was
repaired and an Inspect regression added.

The trusted Workbench passes a prefetched public snapshot and isolates learner
processes with Linux seccomp. Actual API probes denied IPv4, IPv6 and Unix sockets,
a native libc socket call, parent-memory access, and networking from an executed
Python child. Verifier URLs, seed and deployment tag were absent from the child.
The trusted grading proxy still worked after the probe. Docker regressions also
cover CLI isolation and refusal to execute when filter setup fails. The follow-up
process restriction from the trace drill also denies signals and resource-limit
writes against the supervisor. Actual API probes received EPERM for parent SIGKILL,
parent resource-limit modification, setsid and setpgid; normal grading still worked.
Each API run has a fixed process group, cleaned up on exit or timeout, and Compose
init reaps orphans. A regression confirms no running descendant survives a finished run.

The final author suite killed 20 mutants and passed nine learning/boundary tests plus
five Linux runtime tests. CLI Inspect, the completed visible starter, and the label-only
public test also passed.

These runs exercise the participant APIs, not a deployed Portal or live AWS event.
No human playtest or production deployment was performed.
