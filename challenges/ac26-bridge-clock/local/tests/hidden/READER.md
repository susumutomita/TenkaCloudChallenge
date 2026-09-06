# Independent participant reading — Issue #716, clock

Scope: one problem, `ac26-bridge-clock`; baseline main `ad473cdcd43e7ce4b4f2a9a8685983c2f5652b2e`. Root read only participant JA/EN instructions, hints and starter before the rewrite, then the live participant Inspect packets. Root did not read fixtures, hidden checks or reference code. The implementation agent did read internals; its author tests are recorded separately.

## First reading: real defects

Original record: `/private/tmp/bridge-clock-716-first-reading.md` (2026-09-06).

1. External Python and ten copied lines were mandatory before Portal participation; the optional starter contradicted that route.
2. “Random cover hides perfectly” omitted full-range uniformity, independence, observer ignorance and one-use conditions.
3. Three counts equal to one and a total of n do not establish that every entry is one. A general construction and uniqueness argument were missing.
4. Ordinary equality of differences was wrong: n=5, originals4/1, cover3 gives observations2/4; −2 differs from3, although their remainders agree.
5. Clock range alone gives no secrecy; a fixed zero cover is a counterexample. Historical and course-wide claims did not help the task.
6. “Other participants' answers cannot pass” was false for repeated values and constant count patterns.
7. Nested comprehensions and a semicolon-packed required line exceeded the stated beginner path.
8. Negative remainder and operation-order transitions lacked small examples.
9. Wrong prediction was presented as the only occasion to learn or reread.
10. Labels and JA/EN hints needed ID-based alignment, without participant-facing “free/無料” wording.

The implementation review also found that the last two answers were only recalculations of already-visible originals and cover. They now ask for a different construction and recovery from limited knowledge. This change was agreed with the independent reader before implementation. The actual second original and reused cover are excluded from public evidence.

## Baseline live Inspect and hand work

Participant-only packet: `/private/tmp/bridge-clock-716-baseline-packet.md`, fetched from real `/api/inspect` on dedicated localhost Workbench. n=15,u=41,v=23,secret=9,second=14,cover=6.

Root calculated: wrap[11,8]; add[4,4,0] from64 and19; mul[13,13,0] from943 and88; cover0; uncover9; every[1,1,1] because each candidate has exactly one matching cover; count15; reuse[0,5]; leak10. Root also constructed another explanation of [0,5]: originals11/1 with cover4. This motivated using actual constructions instead of copying the original pair.

## Revised reading and hand answers

Root read all revised JA/EN instructions, all 24 hints in both languages, and the optional starter, using `/private/tmp/bridge-clock-716-revised-packet.md`. Root reported no further computational leap, could state the purpose of every field, and confirmed that the task compares knowledge states rather than promising later disclosure by the UI.

Actual public values: n=5,u=14,v=9,secret=2,cover=1,known_first=3,seen1=0,seen2=3.

|ID|Root's answer|Hand calculation|
|---|---|---|
|add|[3,3,0]|14+9=23→3; 4+4=8→3|
|mul|[1,1,0]|14×9=126→1; 4×4=16→1|
|cover|3|2+1=3|
|uncover|2|3−1=2|
|every|[1,0,2]|Candidates[2,3,1]; subtract each from observation3|
|count|5|Five candidates, one corresponding cover each; existence and uniqueness follow from the public formula|
|reuse|[1,4,4]|Choose a=1; r=(0−1)%5=4; b=(3−4)%5=4|
|leak|1|gap=(0−3)%5=2; (3−2)%5=1|

Root's different valid construction: [2,0,3]. Both reproduce observations[0,3] and use a different first original from3. These values were submitted unchanged through real `/api/prepare` and `/verify`; eight accepted answers plus the alternative passed. Actual-original copy [3,1,2], one-equation-only [0,0,0], booleans, floats, wrong width and unwrapped coordinates were rejected. Unsealed and cross-checkpoint submissions were rejected. This is participant-only reasoning followed by actual API evidence, not a claim that reference code proves playability.

Root independently ran the HTTP route again: `/private/tmp/bridge-clock-716-root-http.log`, 15 checks passed. The eight original answers were unchanged; [2,0,3] and a third construction [0,3,0] were also accepted. Root's first harness omitted `files` from prepare and was correctly refused. It then used the real `/api/starter` files, matching the actual editor contract, and retried without changing the mathematical answers.

## Sources checked

- Seminar `/Users/susumu/product/advanced-cryptography-2026/week0/slide.pdf`, PDF pages6–7, on division remainders and clocks. Seminar HEAD `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`.
- Author note `/Users/susumu/product/advanced-cryptography-note/week0/index.html:539–556`, clocks, addition/multiplication and negative remainder; `week2/index.html:551–565`, additive sharing. Note HEAD `58344a29ea39c25839475ba9a594c115ed89989b`.
- Neither the note's shortcut that “no order” gives secrecy, nor deterministic fixture generation, is treated as a proof of a uniform independent mask experiment. The statement supplies the actual distribution/observer assumptions and one-to-one argument.

## Verification record

- `make reference-test IMAGE=ac26-clock-716-check`: reference across20 records; all14 meaningful incorrect implementations killed.18 tests passed in Linux; the2 live-only tests were skipped there and run against the dedicated service separately.
- Pure host suite:15 passed;5 Linux/live-only skipped. Both prime and composite n are exercised; all valid choices of alternative first original and all corresponding covers are enumerated.
- Public function output → raw answer string → prepare seal → real verifier handler:20 records ×8 fields. Lists and tuples print as JSON arrays. This is an author transport regression, separate from the independent hand answers above.
- The author reference also passed the actual Linux Workbench `/api/test`, and its eight printed strings passed real `/api/prepare` → `/verify` unchanged. Log `/private/tmp/bridge-clock-716-author-public-http.log`. This confirms the optional code route and is not counted as independent participant reasoning.
- `make install agent-gate`:116 metadata records valid. Initial catalog failure correctly required the established “前提 / Before you start” heading; headings were restored without weakening the rule.
- Actual Inspect initially failed after its explicit import path was omitted; that path was restored and the rebuilt real Inspect was read successfully. The failure was not represented as a successful packet.
- Linux isolation uses the existing Schnorr workbench, seccomp and protected supervisor implementation inside this problem. FLAG_SEED is injected into verifier only. The initial live process inventory found that clock lacked the existing init/reaper setting; init was added for orphan reaping before the final live check. No limits or test assertions were weakened.
- Final live isolation: both checks passed. The init, learner and healthcheck environments were readable without a seed/key; the supervisor environment was unreadable. The three Linux author-only checks were correctly skipped on this host invocation, having passed inside the author image.
- Logs: `/private/tmp/bridge-clock-716-{reference,pure,catalog,http-final,live-isolation-final}.log`. API regression script: `/private/tmp/bridge-clock-716-http.py`.

The real participant API route was exercised. The full parent Portal, browser layout, physical devices, AWS and third-party human play were not exercised for this increment. No time-to-completion claim is based on the agent's speed. Root reviewed the final diff and owns commit, push and PR.

Root stopped the dedicated ac26-bridge-clock-live-check containers and networks after verification; no project containers remained. The cleanup log is /private/tmp/bridge-clock-716-cleanup.log.

## Final review: independence across messages

PR review correctly identified that one-use and marginal uniformity alone allow correlated covers. For n=5, choose uniform r1 and set r2=(r1+1)%5: each cover is uniform and unequal, but the observations reveal `(m2-m1+1)%5`. The Japanese and English statement and README now require fresh draws independent of every original and independently drawn across messages. Independent draws may coincide by chance; prohibiting equal numerical outcomes would itself introduce dependence. Enumeration confirmed five possible observation pairs for the correlated construction versus all 25 equiprobable pairs for two independent draws. This is a mathematical wording correction; grading and runtime are unchanged.
