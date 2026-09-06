# #716 participant-only reader and validation record

Scope: `ac26-bridge-unknown-x` only, based on remote main
`24ac02fc7e7f2e2683dc7ec6d6d5d893fb6a9329`, 2026-09-06.
This document is author-only and is not in the participant image.

## Source basis, read before rewriting

Both repositories were read directly, rather than inferring the seminar from the
notes alone:

- Seminar repository `advanced-cryptography-2026` at
  `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`:
  `week1/README.md` places arithmetic circuits across ZK/MPC/FHE;
  `week2/README.md` and `week2/problems/toy-mpc/README.md` distinguish local addition
  from multiplication and explicitly explain a reused mask leaking an input
  difference. The public template `week2/problems/toy-mpc/python/template/solution.py`
  (Part A3) supplies the product expansion and the order of opening masked values.
- User notes `advanced-cryptography-note` at
  `58344a29ea39c25839475ba9a594c115ed89989b`:
  `week2/index.html` lines 598–621 pairs local addition with the missing cross
  terms in a product; lines 2698–2716 pair small input/output examples, candidate
  alternatives, and the formula explaining them. `week0/index.html` lines 536–545
  distinguishes ordinary integers from remainder arithmetic.

We adapted the sequence “mechanism → small calculation → observed result”, not
course solutions or source prose. The arithmetic correction in this drill is not
Beaver multiplication itself. In particular, an extra x² is not an explanation of
TFHE bootstrapping, and a large integer mask does not prove secrecy. The full-range
candidate experiment is separate from the generator's narrow integer ranges.

## Independent first read

The root agent read only the participant JA/EN instructions, hints, Inspect output,
and starter. No reference, hidden checker, verifier, or seed was supplied. The first
Inspect was the real `show.py` rendering with synthetic author-local input, clearly
labelled as not yet HTTP acceptance. Packet files were saved at
`/private/tmp/unknown-x-716-reader/baseline-{ja,en}.md`, `baseline-inspect.txt`, and
`baseline-starter.py`.

The reader found actual gaps before revision:

1. The terminal-first route required copying eleven lines; paper and Portal should
   be the entry route, with code optional.
2. Unbounded integer a+x and the finite full-range mask experiment were mixed.
   Define observed=(a+x)%n, construct the matching mask, and distinguish counting
   candidates from an equal-probability statement.
3. Claims that a fifteen-digit mask is hard to guess, all cryptography follows from
   this identity, or x² makes multiplication impossible were too strong. The
   product also needs `(a+b)*x`; someone who knows a,b,x can remove both terms.
4. Reuse reveals at least the difference. Knowing one original also reveals the other.
5. Some answers, including huge, can coincide across experiments; another person's
   numerical answer is not necessarily rejected.
6. The compact generator/sum/any expression was a reading hurdle. A small table and
   candidate-construction formula should precede the loop.
7. The “only a wrong prediction teaches something” claim was unnecessary.

The independent hand calculation used public a=7,b=9,x=12,n=41:
covered `[19,21]`; sum-covered `40`; huge `0` by cancellation; held `[40,24]`;
recover `16`; guesses `41`, constructing cx=(19−ca)%41 for every ca;
gap `-2`; product `[399,255,144]`, since 7*9+16*12=255.

The revised read found a real implementation mistake: the English checks array
had a different order, so an initial positional mapping assigned five hints to
wrong IDs. The metadata and runtime English labels now map by ID. The reader also
requested defining “mask” before using “cover”, and removing “free/無料”, which can
sound monetary. Both changes were applied. The ungraded distinct-mask u/v transfer
was accepted as a useful closing experiment.

## Independent source and actual participant path

The reader wrote `/private/tmp/unknown-x-716-reader/reader-unknown-x.py` solely from
the revised public packet. SHA-256:
`d1d2ad279c8997ad9ce8af4cb086d9c6d1e1102b1121b117392dd75a8bc253ee`.
It was submitted unchanged to the actual Workbench `/api/test`. All eleven public
example checks passed. The second part printed JSON arrays for tuple outputs; those
strings were sent without conversion to `/api/prepare`, and then each returned
submission went through the public `/verify` proxy. All eight passed. Separately,
the eight independent hand answers above passed the same path.

The dedicated local Compose project was `unknown-x-716-20260906`, publishing only
`127.0.0.1:18144` (an override of the problem's default port). Its verifier was not
published. `/private/tmp/unknown-x-716-http-acceptance.py` and `.log` record 45 passing
checks: both reader routes, copyable outputs, independent partial submission, raw
and altered seals, cross-checkpoint and cross-run seals, fractional tuple rejection,
wrong answers, code-only no-credit, unknown IDs, private route refusal, and health.
The live packet/output JSON files are beside the reader packet. No AWS, original
checkout, shared local-play server, or release was involved.

## Seed and grading-boundary regressions

Before the change, a learner submitted via `/api/test` could read `FLAG_SEED`
directly from its environment and through PID 1. The baseline log reports only
booleans: `/private/tmp/unknown-x-716-baseline-proc.log`.
After removing the seed from Workbench service environments, a five-second probe
through the actual learner path inspected all visible process environments.
PID 1, learner, and healthcheck had no seed/key; the supervisor's environment was
unreadable. No secret values are printed. Evidence:
`/private/tmp/unknown-x-716-live-isolation.log`.

The problem-local process restrictions and bootstrap reuse the already tested
Schnorr pattern: protected supervisor, public snapshot, fixed internal derived-key
route, and fail-closed Linux child restriction. These do not add a shared runtime.
The verifier still owns grading. The seed never needs to enter the participant
container, including CLI and Docker healthcheck processes.

The tuple normalizer previously truncated fractional numeric entries with int().
Exact integer checks now reject those values, while retaining integers, integer
strings, and the documented tuple/list/comma-separated formats.

Author checks: existing 25 mutations killed on host and Linux; bootstrap and exact
integer regression tests; actual Linux network/parent restrictions and failure
before learner execution. The author image also carries its Compose file solely
for the service-environment assertion. `make agent-gate` validates all 116 catalog
entries. Logs are saved under `/private/tmp/unknown-x-716-*`.

Final results: host 12 tests passed (five Linux/live checks skipped), Linux author
15 passed (two live-only checks skipped), the separate real-HTTP isolation pair
passed, CLI reader source passed all eleven public checks, and HTTP acceptance
passed 45 checks. The 25 mutations were all killed on Linux. The initial author
image error was a missing test input (`docker-compose.yml`), not a runtime error;
the author-only COPY fixed it without weakening the assertion.

Cleanup completed: both service containers and both dedicated networks were
removed. The project-label container listing is empty. Logs:
`/private/tmp/unknown-x-716-cleanup.log` and
`/private/tmp/unknown-x-716-remaining-containers.log`. Author/build cache images remain;
no shared container, volume, or network was touched.


The final reader review moved tuple/list JSON formatting inside part2's existing
per-answer error handler. A non-serializable result now reports its TypeError and
continues to the next field instead of aborting every later output. The real
part2 function was checked with tuple, list and an unsupported tuple entry; valid
arrays remain byte-identical to the tested HTTP output. Evidence:
/private/tmp/unknown-x-716-formatter-check.log. The final catalog gate passed.
