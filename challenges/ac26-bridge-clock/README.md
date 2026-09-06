# Calculate with remainders and expose cover reuse

> An independent, unofficial companion to Advanced Cryptography Program 2026. It is not affiliated with or endorsed by the course. Statements, code and fixtures are independently authored. Questions belong in the TenkaCloud repository.

`ac26-bridge-clock` · track `advanced-cryptography-2026` · order 14 · difficulty 2 · 100 points · estimated 30–40 minutes · draft.

## Participant route

Start → Inspect evidence → use n,u,v to compare addition remainders and submit the add triple. Paper works; Python is optional. All eight correct fields complete the exercise. JA/EN metadata instructions contain every needed formula and a one-digit example. Each field has three hints: mechanism, formula/example, then named Inspect values and answer control. Penalties are 1/1/2 per field, totaling 32; a wrong answer costs 5.

|ID|Points|Answer|
|---|---:|---|
|add|10|Two addition remainders and their difference|
|mul|10|Two multiplication remainders and their difference|
|cover|10|Remainder after adding the cover|
|uncover|10|Value after removing the cover|
|every|20|Three cover values connecting candidate originals to the observation|
|count|10|Total candidate-cover matching pairs|
|reuse|10|Alternative originals a,b and common cover r; a differs from known_first|
|leak|20|Second original when the first original is also known|

The early practice original and cover are visible. The later two-message record is separate. Its known_first is also displayed from the start: compare an observer knowing only the observations with one also knowing the first original. There is no delayed UI disclosure. The later record's actual second original and common cover are not directly displayed.

Clocks have 5–9 positions, including composite sizes. Addition gives a unique matching cover for every candidate. The probability claim separately requires a full-range uniform cover independent of the original, unknown to the observer and used once. Deterministic practice fixtures are not evidence of that random experiment. Reuse reveals a remainder of the difference, not necessarily its ordinary signed value.

## Runtime and grading boundary

The Workbench carries the public API, starter and public tests. Fixtures, expected values and hidden tests remain in the unpublished verifier image; reference and mutations are author-only. FLAG_SEED is injected only into the verifier. A protected Workbench supervisor fetches a derived sealing key and public snapshot over the internal network. Learner processes receive only the snapshot. Existing Schnorr process restrictions block learner networking, access to supervisor information and surviving child processes on Linux. Failed isolation is not converted into success.

Answers use the existing /api/prepare → /verify seals. Cross-deployment seals are rejected, although correct mathematical values may recur. Reuse accepts every alternative satisfying the documented range, distinct-first-original condition and two common-cover equations. Parsing does not truncate floats, coerce booleans, or omit empty or extra entries.

Only the Workbench is published at 127.0.0.1:18141. The verifier on port 18151 is internal only. Both run non-root, with read-only filesystems, no capabilities, no-new-privileges and CPU/memory/PID limits. This remains self-study honor-system verification against the person controlling the host or Docker daemon; it does not claim secrecy from that administrator.

## Course connection

Checked lecture week0/slide.pdf pages 6–7 on remainders and clocks, the author's week0 note on clocks and negative remainders, and week2 additive sharing. The shortcut that lack of order alone hides a secret is not adopted: distribution and observer-knowledge assumptions are explicit. Source paths and independent first/second readings are recorded in local/tests/hidden/READER.md.

## Local checks and teardown

```sh
make inspect
make test
make test-one ID=reuse
make reference-test
make verifier-down
```

The untouched starter is deliberately incomplete and fails public examples. Learners fill functions in the editor. Public test part 1 checks statement examples; part 2 displays their own outputs without grading the deployment answers. Lists/tuples print as JSON arrays that can be copied directly. Author-only reference-test checks 14 broken implementations, correct output transport across 20 records, all valid alternative constructions and malformed inputs, Linux isolation and key bootstrap.

Dedicated live HTTP boundary check:

```sh
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-bridge-clock-live-check up -d --build --wait
CLOCK_WORKBENCH_URL=http://127.0.0.1:18141 python3 -m unittest discover -s local/tests/hidden -p test_isolation.py -v
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-bridge-clock-live-check down
```

The actual participant API was exercised as recorded in local/tests/hidden/READER.md. The full parent Portal, a physical device, and AWS were not exercised. An independent human playtest remains an optional rehearsal.

## Resources and cost

No AWS resources are created. The exercise uses local Docker CPU, memory, disk and image-download networking. Services run until Compose down; image/build caches remain on disk afterward.
