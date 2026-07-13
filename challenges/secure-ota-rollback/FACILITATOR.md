# Facilitator guide — Northstar OTA Recovery Mission

The platform's five checkpoints evaluate executable invariants. This guide is a
separate 100-point human review for architecture reasoning. Do not copy the
rubric score into the automatic `multi-verify` result.

## Before the session

1. Confirm both loopback health endpoints and run `POST /reset` twice.
2. Confirm the initial `signed-ordered`, `tampered`, `resume`,
   `health-failure`, and `audit-trace` observations are unsafe.
3. Confirm only ports 18100/18101 are published and the compose network has no
   external egress.
4. Remind learners that this is fictional, local-only, and not a production
   vehicle or Uptane compliance test.

## Expected automatic boundary

The intended hardened behavior enforces publisher signature, monotonic version,
target/dependency checks, dependency ordering, checkpointed bounded resume,
known-good rollback, and one root correlation ID. Accept alternate settings only
when all behavioral probes still pass; the verifier is authoritative for the
automatic checkpoints.

## Human rubric (100 points)

### Architecture and evidence — 25

- 0: Lists components without data/state flow.
- 10: Shows package, inventory, and report flow but confuses delivery with trust.
- 20: Separates signing, scheduling, transport, ECU validation, boot, and audit
  decisions and cites trace/slot evidence.
- 25: Also identifies missing evidence and proposes a repeatable acceptance test.

### Threat model — 25

- 0: Generic threat list with no assets or trust boundaries.
- 10: Covers altered/unsigned/downgrade packages or bus interruption.
- 20: Connects actors, assets, boundaries, abuse cases, controls, and evidence.
- 25: Distinguishes failure from attack, includes key compromise and replay, and
  states what the MVP cannot establish.

### RACI and hand-offs — 25

- 0: No accountable owner or every row is “shared.”
- 10: Assigns OEM, supplier, OTA operator, and SOC roles.
- 20: Gives one accountable owner per decision and names hand-off artifacts.
- 25: Adds stop authority, incident escalation, key/supplier transition, and
  acceptance tests for responsibility gaps.

### Residual risk — 25

- 0: Claims that passing the lab makes production OTA secure/compliant.
- 10: Names at least secure boot, key rotation, or power/storage constraints.
- 20: Prioritizes risks with owner and compensating control.
- 25: Adds detection/recovery evidence, long-term migration, owner notification,
  and a concrete next validation step.

## Threat model prompts

- Assets: signing key, approved manifest, firmware payload, vehicle inventory,
  ECU known-good state, audit evidence.
- Actors: OEM release authority, supplier build system, OTA operator, TCU/bus,
  ECU software, SOC analyst, malicious insider, network attacker.
- Boundaries: signing-to-OTA, cloud-to-TCU, bus-to-ECU, install-to-boot,
  component telemetry-to-audit.
- Lab assumption: ECU B reads ECU A's live state on the isolated service network;
  production needs authenticated, freshness-protected inventory attestation.
- Abuse/failure cases: signing-key compromise, altered metadata/payload,
  unsigned package, downgrade/replay, wrong target/dependency, disconnect storm,
  duplicate install, health failure, fragmented/missing trace.

## Residual risk examples

The MVP omits secure boot and hardware trust anchors, key ceremony/rotation and
revocation, threshold release approval, encrypted transport, vehicle identity,
power/storage/thermal preconditions, partial fleet rollout, owner notification,
tamper-resistant logs, authenticated inter-ECU inventory attestation, long-term
certificate/supplier/cloud migration, and real CAN/Automotive Ethernet timing.
Learners should prioritize rather than merely list these.

The workshop validates a combined policy patch before contacting any component,
but it does not implement a distributed transaction across TCU and ECU services.
A mid-flight component outage can therefore require reconciliation. Production
needs versioned desired state plus rollback or two-phase/reconciliation evidence.

## Debrief

Ask each learner to identify one decision owned by the cloud/TCU and one that
must remain local to the ECU. Then compare one failure trace and one rejection
trace. End by asking which missing control would invalidate the strongest claim
in their report.
