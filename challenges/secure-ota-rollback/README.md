# Northstar OTA Recovery Mission

## Introduction

Northstar's production review is tomorrow, but its virtual vehicle cannot yet
prove that an update is authentic, compatible, restart-safe, recoverable, or
auditable. You inherit one TCU, two ECUs, a user-space vehicle bus, and isolated
OTA and signing services. The controls begin in a deliberately unsafe state.

This is an AWS-free local-play Challenge. It is a teaching-scale model, not an
Uptane implementation or a claim of regulatory compliance. It runs entirely in
Docker and does not require hardware, a production cloud, or an external
account.

## First step

Start it from the TenkaCloud repository:

```bash
make local PROBLEM=secure-ota-rollback
```

Inspect the inherited controls and A/B slots, then run the authentic update:

```bash
curl -s http://127.0.0.1:18100/api/state
curl -s -X POST http://127.0.0.1:18100/run \
  -H 'content-type: application/json' \
  -d '{"scenario":"signed-ordered"}'
```

Do not begin by guessing settings. Compare the manifest dependency, bus delivery
order, ECU slot state, install counts, and correlation IDs.

## Goal

Repair the existing TCU and ECU controls through `PATCH /api/config`. Re-run the
normal and fault scenarios until all five behavioral checkpoints pass:

1. an authentic update reaches ECU A before its dependent ECU B;
2. altered, unsigned, and downgrade packages leave ECU slot/install state unchanged;
3. a transient bus disconnect resumes without reinstalling completed work and a
   longer disconnect stops at a bounded retry limit;
4. a failed boot returns to the known-good slot; and
5. signing, OTA, TCU, bus, ECU A, and ECU B form one correlated audit timeline.

Each checkpoint is submitted independently through the Participant Portal. The
container verifier runs fresh behavioral probes; it does not trust configuration
flags or a memorized answer.

## Safety boundary

- All names, vehicles, packages, and events are fictional.
- Only `127.0.0.1:18100` (workshop) and `127.0.0.1:18101` (verifier) are
  published. No service binds a host port on a non-loopback address.
- The six-service network is Docker-internal, so it provides no route to an
  external network. OTA publishes only its two loopback ports from that network.
- Containers run as an unprivileged user, drop all Linux capabilities, forbid
  privilege escalation, use a read-only root filesystem, and have CPU, memory,
  PID, and temporary-disk limits.
- The signing private key is generated in the signing process's memory at
  runtime and never leaves that process. ECUs fetch only the public key over the
  Docker-internal service network.
- There are no host mounts, production credentials, committed secrets, malware,
  or real vehicle interfaces.

## Architecture and responsibility boundaries

The lab uses six processes, each in its own container:

| Component                 | Owns                                                                                              | Must not own                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Signing                   | Ed25519 private key and canonical manifest signature                                              | Vehicle state, delivery, install, or rollback decisions |
| OTA / workshop / verifier | Campaign fixtures, learner API, audit collection, behavioral checks                               | ECU acceptance or boot decisions                        |
| TCU                       | Dependency ordering, bounded delivery retry, durable completion set, root correlation propagation | Signing keys or ECU slot promotion                      |
| User-space bus            | Addressed delivery and deterministic disconnect injection                                         | Package trust or campaign policy                        |
| ECU A                     | Local package validation, A/B install, health gate, known-good state                              | ECU B's install or cloud campaign policy                |
| ECU B                     | The same local decisions plus its declared dependency on ECU A                                    | Trusting TCU delivery as proof of authenticity          |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the state machine and trust
boundaries, [RACI.md](./RACI.md) for the OEM/supplier/operator/SOC handoff, and
`diagram.svg` for the participant-facing topology.

## Workshop API

### Observe

```bash
curl -s http://127.0.0.1:18100/api/state
curl -s http://127.0.0.1:18100/api/scenarios
curl -s http://127.0.0.1:18100/api/audit
```

`/api/state` shows the current TCU policy, both ECU policies and slots, the
latest campaign, the injected bus fault, delivery attempts, and audit events.

### Run a bounded scenario

```bash
curl -s -X POST http://127.0.0.1:18100/run \
  -H 'content-type: application/json' \
  -d '{"scenario":"resume"}'
```

The public scenarios are:

| Scenario         | Observation target                               |
| ---------------- | ------------------------------------------------ |
| `signed-ordered` | Dependency order and final versions              |
| `tampered`       | A payload and manifest altered after signing     |
| `unsigned`       | A package with no publisher signature            |
| `downgrade`      | A version below the active version               |
| `resume`         | One deterministic bus disconnect before ECU B    |
| `health-failure` | A newly written image that fails its health gate |
| `audit-trace`    | The end-to-end event timeline                    |

Every `/run` resets ECU data and the bus log while preserving your current
control policy. This makes scenarios repeatable without hiding cross-scenario
state.

### Change controls

`PATCH /api/config` accepts a partial object with a `tcu` object, an `ecu`
object, or both. The field names and current values are visible in `/api/state`.
Send one hypothesis at a time, re-run the relevant scenario, and explain why the
observed state changed. Invalid field values fail closed with HTTP 400.

### Verify a checkpoint

The Participant Portal normally calls the verifier. For a direct contract smoke
test:

```bash
curl -s -X POST http://127.0.0.1:18101/verify \
  -H 'content-type: application/json' \
  -d '{"checkpointId":"signed-ordered-install","submission":"VERIFY","context":{}}'
```

The response echoes `checkpointId` and returns only the behavioral verdict. The
five checkpoint IDs match `metadata.json`.

### Reset

```bash
curl -s -X POST http://127.0.0.1:18100/reset
```

Reset is idempotent: repeated calls restore the same factory versions, active A
slots, empty audit and delivery logs, and original unsafe policies. It completes
in seconds, well inside the ten-minute acceptance limit.

## A/B, version, dependency, and retry model

- Both ECUs start on healthy version 1 in slot A; slot B is empty.
- A package carries campaign, target ECU, version, dependency, and payload-hash
  metadata in a canonical signed manifest. Boot health is measured locally and
  is never a publisher-controlled manifest claim.
- Installation writes only the inactive slot. A healthy boot can promote it to
  known-good; a failed boot must keep the failed image as evidence but return
  the active pointer to the previous known-good slot.
- ECU B's update depends on ECU A reaching the required version. TCU ordering
  and ECU B validation against ECU A's live state are independent controls;
  caller-supplied inventory is ignored.
- The bus fault counter is deterministic. The verifier uses both a one-failure
  interruption and a longer interruption to distinguish resume from unbounded
  retry.
- The TCU keeps completion per campaign attempt so an already completed ECU is
  not installed twice during resume.

## Automatic scoring and human review

The five `multi-verify` checkpoints total 300 points. Hints progress from
observation, to diagnosis, to a design principle. The verifier evaluates live
state transitions and negative cases rather than comparing a secret flag.

Automatic scoring deliberately does not grade the quality of an architecture
argument. After the checkpoints, prepare a short report containing:

- a RACI for OEM architect, ECU supplier, OTA operator, and SOC analyst;
- a threat model that names assets, actors, trust boundaries, abuse cases, and
  evidence;
- residual risks and the production controls omitted from this MVP; and
- the correlation ID and event sequence that support your conclusions.

Facilitators grade that report separately with the 100-point rubric in
[FACILITATOR.md](./FACILITATOR.md). Passing the automatic checks is necessary
but does not automatically earn the human-review score.

## Resource and cost bounds

Each service is capped at 0.5 CPU, 96 MiB RAM, 64 PIDs, and a 16 MiB temporary
filesystem. In the worst declared configuration, delivery retry is hard-capped
by the service even before learner remediation. Audit and bus logs are bounded,
HTTP bodies are limited, and operations are serialized. No AWS resources are
created, so cloud cost is zero; local Docker CPU and disk usage are the only
costs.

## Docker and Codespaces smoke test

Docker Desktop, Docker Engine with Compose v2, and GitHub Codespaces all use the
same compose entrypoint:

```bash
docker compose -f challenges/secure-ota-rollback/local/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:18100/healthz
curl -fsS http://127.0.0.1:18101/healthz
docker compose -f challenges/secure-ota-rollback/local/docker-compose.yml down -v
```

In Codespaces, run the commands in its terminal. Do not change port visibility
from private/loopback; the exercise does not need a forwarded public port.
