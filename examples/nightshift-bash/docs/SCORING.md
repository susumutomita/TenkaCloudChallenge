# Standalone scoring contract

`gameday.sh score TEAM --json` emits one JSON object. It is not a TenkaCloud-native `/verify` response.

- `schemaVersion`: currently 1.
- `team`: validated lowercase team identifier.
- `phase`: `audit` or `repair`.
- `score`, `maxScore`: current total and 1000.
- `discovery`, `repair`, `service`: components, bounded by 300/400/300.
- `checks`: numeric booleans (0 or 1), not JSON `true`/`false`.

Checks are `backupBeforeRestart`, `pathBeforeRestart`, `restart`, `backupProtected`, `pathProtected`, `durable`, `validOrders`, `deduplication`, and `invalidRejected`.

Scoring is active, not a read-only query. During repair it places/restores a harmless command probe, submits generated order fixtures, restarts the batch service, and repeats a second restart when the first passes. The final reported state is the last tested state, including a regression at the second restart. Missing/failed service work cannot earn repair points. Unknown verifier output causes a failure, not a score update.

`repair = 150 * backupProtected * serviceOK + 150 * pathProtected * serviceOK + 100 * durable`, where `serviceOK` is the conjunction of validOrders/deduplication/invalidRejected.

`service = 100 * validOrders + 100 * deduplication + 100 * invalidRejected`.

The checksum is SHA-256 of the exact UTF-8 string `ID|quantity|unit_price|total|exercise_key`, with no trailing newline. It is a test integrity predicate, not a recommended authentication/signature scheme. The exercise key is randomly generated per run and is never passed to the worker in its process arguments.

The host writes an atomic current-score file and append-only-by-convention JSONL history. History is not cryptographically signed or tamper-proof to the host owner. A timestamped entry is `{ "recordedAt": "UTC timestamp", "result": { ...score... } }`.

Discovery values are stored outside the target. They are monotonic only within the same audit phase and freeze on promotion. No hint/wrong-answer penalty is enabled. Reset deletes history, discoveries, and secrets. Phase and state files are parsed as data, not sourced as shell code.

Commands have time limits, bounded input/output reads, and per-team host locks. These limits are safeguards for this training workload, not proofs of resistance to an actively malicious participant trying to attack the grader. Teams must stop editing while grading.
