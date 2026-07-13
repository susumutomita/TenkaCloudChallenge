# Secure OTA RACI

This matrix is a starting acceptance boundary, not a claim that all OEMs use the
same organization. A learner may propose a different assignment if every row has
one accountable owner and the evidence/hand-off remains testable.

Roles: **OEM** = OEM architect/product security, **Supplier** = ECU supplier,
**OTA** = OTA platform operator, **SOC** = security operations.

| Activity / decision                                          | OEM | Supplier | OTA | SOC | Evidence / acceptance test                           |
| ------------------------------------------------------------ | --- | -------- | --- | --- | ---------------------------------------------------- |
| Define vehicle compatibility and ECU dependency policy       | A/R | C        | C   | I   | Version/dependency contract and ordered-install test |
| Build ECU firmware and declare target/version/dependencies   | A   | R        | I   | I   | Reproducible artifact and manifest review            |
| Approve a release for signing                                | A/R | C        | C   | I   | Two-person release record outside this MVP           |
| Protect the signing key and sign canonical metadata          | A   | C        | R   | I   | Key custody log and signature verification           |
| Select vehicles and run a campaign                           | A   | I        | R   | I   | Campaign target and rollout record                   |
| Order delivery, checkpoint completion, and bound retry       | A   | C        | R   | I   | TCU trace, retry-limit and idempotent-resume tests   |
| Validate package locally and install inactive slot           | A   | R        | C   | I   | ECU rejection tests and A/B slot state               |
| Run boot health gate and restore known-good                  | A   | R        | C   | I   | Failed-health trace and active-slot proof            |
| Correlate telemetry, detect anomalous updates, triage impact | A   | C        | C   | R   | One correlation timeline and incident record         |
| Revoke/rotate keys and coordinate supplier/cloud handoff     | A/R | C        | C   | C   | Migration and recovery plan (not automated here)     |

Legend: **R** Responsible, **A** Accountable, **C** Consulted, **I** Informed.

## Required hand-offs

- Supplier to OEM: artifact identity, target ECU, compatibility/dependencies,
  expected health behavior, and reproducible test evidence.
- OEM to signing/OTA: approved immutable manifest and rollout authorization.
- OTA/TCU to ECU: signed package plus root correlation ID; never a command to
  bypass local verification.
- ECU to OTA/SOC: acceptance/rejection reason, slot transition, active and
  known-good versions, and the same root correlation ID.
- SOC to OEM/supplier/operator: timeline, suspected failure vs attack,
  affected scope, containment, and missing evidence.

## Learner submission

State any changed R/A assignments, why they reduce ambiguity, what evidence
crosses each hand-off, and who can stop a rollout. A matrix with names but no
acceptance evidence is incomplete.
