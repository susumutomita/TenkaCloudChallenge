# Stale Request Note — php-memory-lifetime-lab

Isolated beginner lab: a tiny C program keeps a worker pointer into freed
request-owned heap; participants observe it with AddressSanitizer, OBS logs and
optional batch gdb, call a predeclared harmless `record_lab_event`, then confirm
a fix that clears the retained pointer while keeping the normal path.

This is **not** a reproduction of PHP CVEs, not an exploit trainer, and not a
stack return-address overwrite drill. It complements
[`memory-slot-lab`](../memory-slot-lab/) (safe JS semantic model from #923): that
problem stays a closed simulation; this one owns real C observation for #925.

## Run locally

Needs Docker. From this problem directory:

```sh
export FLAG_SEED="$(openssl rand -hex 32)"
docker compose -p php-memory-lifetime-lab -f local/docker-compose.yml up --build -d --wait
# Web: http://127.0.0.1:18080
# verify: http://127.0.0.1:18081/verify
```

Host-side unit tests (no Docker required for the Node parts; binaries optional):

```sh
# Optional: build teaching binaries on a machine with gcc + libasan
make -C local/c BINDIR="$PWD/local/bin"
LAB_BIN_DIR="$PWD/local/bin" FLAG_SEED="$(openssl rand -hex 32)" node --test tests/*.test.mjs
```

Teardown:

```sh
docker compose -p php-memory-lifetime-lab -f local/docker-compose.yml down
```

## Story, participant route and expected behavior

| Step | What they do | Observable success |
| --- | --- | --- |
| Predict + ASan | Run buggy `uaf` under ASan | OBS `stale=1` and ASan `heap-use-after-free`; flag `observe-asan` |
| Optional gdb | Batch gdb at `next_request_consume_stale` | Frame/locals/`worker_retained_note` (best-effort) |
| Quiz | Choose stack vs heap explanation | Flag `stack-heap` |
| Lab event | Button runs `record_lab_event("checkpoint")` | Harness fd 3 records `checkpoint`; flag `lab-event` |
| Fix | Run fixed stale + normal | `consume_rejected` and normal `ok` + event; flag `fix-ok` |

Crash alone is never enough. Flags look like `TC{` + 32 hex digits.

## Components

- `local/c/lab_buggy.c` / `lab_fixed.c` — teaching programs (+ ASan builds).
- `local/app/harness.mjs` — spawns binaries, parses OBS, captures fd 3 events.
- `local/app/server.mjs` + `index.html` — guided Web UI.
- `local/verify/server.mjs` — multi-verify authority (`checkpointId` echoed).

## Safety boundary and relation to PHP

- Non-root, read-only rootfs with `/tmp` tmpfs, `cap_drop: ALL`, no-new-privileges,
  loopback-published ports, internal networks, CPU/mem/pids limits, no Docker socket,
  no host secrets in the participant image beyond the per-run `FLAG_SEED` injected
  for minting teaching flags (same pattern as `greeting-expression-lab`).
- No real PHP exploit, arbitrary code, OS command execution, or protection bypass.
- Stack return-address overwrite is **not** claimed as the cause of
  [CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w)
  / [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp).

### Verified PHP patch citation

Upstream commit
[`3584a98bda0f2c0d367255b046798b0d3a221a19`](https://github.com/php/php-src/commit/3584a98bda0f2c0d367255b046798b0d3a221a19)
(*Avoid state corruption via bailout*) fixes both advisories (message cites
GHSA-w8hw-w9fx-j79w and GHSA-6wmf-4rv5-p3rp). Verified file-level changes include
delayed OOM state in `Zend/zend_alloc.h` and clearer reset of executor globals such
as `EG(errors)` / object store fields in `Zend/zend_execute_API.c` during shutdown.
**Exact line numbers in a release tarball can shift; cite the commit, not invented
lines.** The lab's NULL-clear is a teaching invariant, not that patch.

## Relation to #923 / memory-slot-lab

| | memory-slot-lab | this problem |
| --- | --- | --- |
| Memory | JS slot model | Real C heap + ASan |
| Goal | Write guard JSON | Observe + harness event + fix regression |
| CVE | Background only | Background only |
| Completes #925 alone? | No | Addresses real-observation design of #925 |

## Measured verification and limits

On the author machine (2026-10-30 Asia/Tokyo):

- `node --test tests/*.test.mjs` with locally built binaries: 9/9 pass.
- `docker compose up --build -d --wait` then POST `/api/observe`, `/api/quiz`,
  `/api/lab-event`, `/api/fix`, `/api/gdb` and matching `/verify` for all four
  checkpoints: all correct. ASan reported `heap-use-after-free`; gdb batch stopped
  on `next_request_consume_stale`.
- `bun run validate`: 29 metadata records valid; `make agent-gate` passed.
- Compose uses a single bridge network with loopback-published ports. Fully
  `internal: true` networks did not publish host ports under this Colima setup.
- Portal event create → start → grade → teardown was **not** run (optional per
  `AGENTS.md`). No claim is made about real PHP, CVE reproduction, RCE, AWS or
  production safety.

## Cost-bearing resources and teardown

No paid cloud resources. Region: n/a. Suggested session: 40 minutes. Stop with the
exact Compose project name and `down`. No persistent volumes.
