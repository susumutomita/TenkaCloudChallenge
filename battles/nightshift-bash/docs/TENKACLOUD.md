# TenkaCloud integration status

This release is a **standalone operator-CLI prototype**, not an installed/catalog-ready TenkaCloud problem. This draft contribution stages the existing standalone payload under `battles/nightshift-bash/`. It does not modify TenkaCloud, register the problem, or declare unsupported metadata.

The catalog README and authoring contract were inspected on 2026-09-23. They distinguish problem payloads from platform-owned deployment/scoring dispatch and require a supported verifier contract for local-play containers. They also warn that adding a schema value is not evidence of executable platform support.

Sources:
- https://github.com/susumutomita/TenkaCloudChallenge/blob/main/README.md
- https://github.com/susumutomita/TenkaCloudChallenge/blob/main/AGENTS.md

This pack therefore deliberately does not claim a fabricated metadata runtime, ship an always-correct verifier, or expose the host's Docker socket to a participant web process.

## Draft scope and catalog gate

No `metadata.json` is provided. The current catalog validator discovers metadata files recursively, so a green catalog-only check would not validate this unregistered payload. The dedicated Nightshift workflow runs Bash syntax and the actual Docker integration suite from this directory instead. Do not mark native catalog support complete based on either check.

The current standalone image has a root supervisor for UID transitions; participant shells and editable workload code are non-root. This differs from the catalog's non-root Compose/verify contract and must be resolved in a coordinated platform design, not hidden by a fabricated `runtime` value. Participant statements/hints are currently Japanese; the package README is bilingual. Native registration also requires English participant content.

## Existing boundaries available for an adapter

`start`, `shell`, `submit`, `repair`, `score --json`, `reboot`, `reset`, and `down` provide a concrete standalone execution contract. Per-team secrets and score authority are host-side. The JSON score is described in `SCORING.md`. The participant surface and host grader are distinct directories, and the image does not contain grader/reference files.

## Work still required for native integration

A platform-owned adapter must authenticate the team and organizer, bind the team to exactly one target, provide a constrained terminal session, invoke the trusted scorer without accepting a participant-selected container name or command, and translate the resulting evidence into the platform's actual supported scoring contract. A scheduled tick should have concurrency control so multiple scoring workers cannot grade the same target simultaneously.

An organizer-only phase transition must freeze discovery and provide a new operator session while keeping old auditor sessions low-privileged. Reset must rotate secrets and invalidate old sessions and score state. Native participant instructions and score feedback need a portal-level test. A real supported runtime/metadata implementation and coordinated platform change are necessary before listing this as playable in TenkaCloud.

No HTTP server, `/verify` endpoint, SSH gateway, browser terminal, or TenkaCloud catalog metadata is included in this standalone version. These omissions are explicit, not hidden behind placeholders.
