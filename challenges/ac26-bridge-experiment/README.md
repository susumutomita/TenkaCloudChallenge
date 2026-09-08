# Predict, then run

> An independent, unofficial companion to Advanced Cryptography Program 2026. It does not represent course endorsement or official grading.

Investigate remainders through prediction, an intermediate error, implementation, recovery, a case without recovery, and efficient counting. The free statement gives every necessary rule and a small example. Each of seven fields has three hints: mechanism, example, and steps using the screen's names.

Start with **Start → Inspect evidence → Submit on environment**, then follow predict on paper. Seven fields total 100 points. Wrong answers cost 5; the first hint in each of the first three fields costs 1 and the others cost 2, or 39 for all 21. Existing checkpoint IDs, points and grading modes are preserved.

| Field | Submission | Points |
|---|---|---:|
| environment | Running environment's phrase (automatic) | 10 |
| predict | Final number | 10 |
| first-broken | Out-of-range entry's position, starting at 0 | 10 |
| generalize | counter.py implementing advance | 20 |
| walkback | Round count within the specified range | 15 |
| no-walkback | A new ring size sharing a divisor with step | 15 |
| count-no-walkback | counter.py implementing inclusion–exclusion | 20 |

## Scope of the mathematics

A remainder has several possible original integers, but using remainders alone does not protect a secret. An inverse of step recovers the count in range; without one, several counts share an output. That ambiguity differs from computational difficulty on a cryptographic elliptic curve. The final task implements efficient counting for any number of distinct prime factors, correcting overlaps and inclusive endpoints.

We checked the lecture repository's Week 1 README and public proof-of-exploit description (remainder-valued signals, required conditions and counterexamples), and the author's week0 notes on remainders, inverses and zero divisors. The notes also motivate keeping a formula, result and explanation together. No course solution or hidden test was copied. The existing week1/diagnostic placement is retained; no citation to the excluded week0/slide.pdf was added.

## Runtime and assurance

Compose starts a Workbench and a verifier. Only the Workbench is published, at `127.0.0.1:18091`; the verifier uses the internal network. The Workbench image contains starter code, public tests and display code, not fixtures, grading or reference solutions. Only the verifier receives the seed. The Workbench supervisor, healthchecks and submitted public-test code do not receive it. Public evidence is fetched from the verifier. The same seed produces the same values; restarting alone does not necessarily change them.

This is self-paced local honor-system verification. Resource limits apply, but it **does not guarantee a sandbox isolating malicious submissions from secrets, competition ranking or examination integrity**. Code grading executes inside the verifier, and a Docker administrator can inspect internals too. Learner network denial and cleanup of every descendant process are not guaranteed.

No AWS resources are created. Running containers consume local Docker CPU, memory and disk. Stop the project you started with `make verifier-down` afterward.

## Local verification

- `make test` / `make test-one ID=...`: public tests; the unfinished advance starter should fail.
- `make inspect`: public evidence; the Portal submits the environment phrase automatically.
- `make reference-test`: the reference and 14 mutations inside the author image.
- `make install && make agent-gate` at the catalog root: metadata and catalog validation.

The participant HTTP route and independent first-reading gaps and reread outcomes are recorded in `local/tests/hidden/READER.md`. Live AWS and third-party participant play remain unrun.

Issue #716 reader follow-up documents the slow-copy name and a small comparison before submission; see `local/tests/hidden/READER.md`. Reference validation killed14 mutants and passed the public-process isolation check. Two live-workbench checks were skipped by the author target.

## Function evaluation boundary

The trusted parent grades returned function values. Learner functions run in a restricted Linux process with a 12-second total limit; their output does not decide the score. Public arithmetic inputs and API signatures are unchanged, including bytes/bytearray and tuple/list results where supported. `make evaluation-test` checks the reference through the actual evaluator, missing implementations, and type preservation. Deployment and platform score-history persistence are not covered by this local check.

### Supported computation imports / 計算用の標準ライブラリ

`array`, `base64`, `binascii`, `bisect`, `collections`, `contextlib`, `copy`, `dataclasses`, `decimal`, `enum`, `fractions`, `functools`, `hashlib`, `heapq`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `re`, `statistics`, `string`, `struct`, `time`, `typing`.

The starter lists the same optional standard-library helpers. Its original imports (including __future__ and supplied problem APIs) remain supported. Other optional imports and file/network operations are not supported by the evaluator.
スターターにも同じ追加用の一覧を表示します。最初からあるimport（__future__や教材のAPIなど）は引き続き使えます。それ以外の追加importとファイル・通信操作は採点環境では対応しません。
