# Suspect ICMP during PXE boot — pxe-icmp-oob

A safe, process-local model of the parser-bug pattern behind the EDK II PXE ICMP-error
buffer overflow (CVE-2026-97631). It does **not** run real UEFI firmware, Secure Boot, TPM
code, or on-wire packets. It only recreates a fixed 504-byte receive buffer and a copy loop
that advances the destination by the *cumulative* fragment length. Real abuse needs a PXE
boot window, LAN reach during those seconds, and per-build address tuning — none of which
exist here. Submitted bytes are discarded when the request ends.

## Run locally

From this problem directory, with Node.js 22 or newer and no dependencies:

```sh
node --test tests/*.test.mjs
EVALUATOR_URL=http://127.0.0.1:8082 node local/app/server.mjs
# other terminal:
FLAG_SEED=local-fixture-only node local/verify/server.mjs
```

Open `http://127.0.0.1:8080`. Read `/spec`, send fragments to `POST /icmp`, answer the
quizzes. Stop with Ctrl+C. `FLAG_SEED` is a per-run fixture seed TenkaCloud injects through
`secretEnv`; only the private authority receives it. The surface forwards original input to the
internal evaluator on port 8082; it cannot supply an answer, computed checkpoint, analysis, or seed.
Start the authority before submitting through the surface. The published verifier port serves
only `/verify` and never the internal evaluation routes. Never commit plaintext flags.

## Story, participant route and expected behavior

Investigate the fictional **NetBoot lab / EDK-toy** collector. First action: open `/spec`
and note `icmpErrorSize` (504). Then craft ICMP-error fragments (hex or base64) and watch
`writes[].offset`, `overflowedBuffer`, `guardIntact`, and `handlerTag`. Five independent
checkpoints (100 points total, Easy tier):

| id | points | evidence |
| --- | --- | --- |
| buffer-shape | 15 | one fragment of exactly 504 bytes |
| cumulative-advance | 25 | multi-fragment send with total ≤ 504 yet a write past 504 |
| overwrite-secret | 30 | adjacent `handlerTag` rewritten to `debug` |
| boot-scope | 15 | quiz: disk-only boot is out of scope because the copy runs only on PXE |
| impact-class | 15 | quiz: hang/crash = DoS; steered control = code-execution class |

Scoring is `multi-verify`. Portal posts `{checkpointId, submission}` to the loopback
verifier; the response echoes `checkpointId` and returns `{correct, message}` without
points or the expected flag.

## Components

- `local/app/model.mjs` — public buffer simulator, input decoder and quiz questions/options.
- `local/verify/grading.mjs` — private checkpoint predicates, quiz keys and flag derivation.
- `local/app/server.mjs` + `index.html` — participant surface (`/`, `/spec`, `/icmp`, `/quiz`).
- `local/verify/server.mjs` — `/verify` on 8081 and raw-input evaluation on internal-only 8082; neither grading module nor seed is in the surface image.
- `tests/*.test.mjs` — model properties and an HTTP end-to-end solve of all five checkpoints.

## Safety boundary and relation to CVE-2026-97631

| Real issue | This lab |
| --- | --- |
| Fixed ~504-byte `Mode.IcmpError` in NetworkPkg/UefiPxeBcDxe | Same size, toy struct |
| Broken bounds check + cumulative destination advance | Recreated in `collectIcmpError` |
| Ring 0 before OS / Secure Boot; TPM reachable | Plain Node process; no privileges |
| Needs PXE window + LAN ICMP delivery + per-build ROP/steering | Out of scope; quizzes teach why |
| Firmware update is the real remediation | Documented only; nothing to patch here |

This lab neither ships an exploit against real firmware nor validates vendor patches.

## Containers and platform integration

```sh
FLAG_SEED=local-fixture-only docker compose -p pxe-icmp-oob -f local/docker-compose.yml up --build -d --wait
# Web: http://127.0.0.1:18080 ; verifier: http://127.0.0.1:18081/verify
FLAG_SEED=local-fixture-only docker compose -p pxe-icmp-oob -f local/docker-compose.yml down
```

Ports bind to `127.0.0.1`. Images run as non-root, read-only, with `cap_drop: ALL` and a
health check. The services share an internal Compose network; only web and `/verify`
ports are published on loopback. The evaluator has a bounded body and the surface uses a
3-second timeout, returning 503 when it is unavailable. Status is `draft` until this smoke test has been run on a Docker host.

## Cost-bearing resources and teardown

None. Local Docker only; no AWS / cloud resources. Tear down with `docker compose … down`.

## Local verification claimed

- `node --test tests/defensive*.test.mjs`: six defensive/static/benign HTTP tests passed.
- Selected existing model tests: flag derivation, in-bounds 504-byte fill and quiz grading passed.
- `make agent-gate`: catalog validation and root contracts passed.
- Existing nonempty out-of-bounds model cases and the full five-checkpoint HTTP solve were
  not re-executed during this defensive review fix. Their import/startup wiring was updated.
- Docker build/run — **not verified** on the authoring box (no Docker); keep `draft`.
