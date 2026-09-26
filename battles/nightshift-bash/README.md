# NIGHTSHIFT — Protect the Night Batch

**[日本語の起動手順](README.ja.md)**

A standalone, Bash-and-Linux-utilities Battle: investigate, demonstrate a harmless misuse, repair without interrupting valid order processing, and verify the result after restarting the batch service.

Version 0.1.0 includes three missions, two non-root participant roles, organizer-side scoring, per-run random exercise keys, staged hints, reference solutions, and integration tests. Python, Node.js, AWS accounts, and offensive frameworks are not runtime dependencies. Docker supplies the disposable Linux environment; “Bash only” does not mean “shell builtins only.”

**Standalone CLI pack:** this directory intentionally has no `metadata.json` and is not selectable in the Portal. Native registration, a supported runtime/scoring adapter, and bilingual participant surfaces are not implemented. See [integration status](docs/TENKACLOUD.md).

## Start

From the repository root, enter `battles/nightshift-bash` with Docker Engine/Desktop running:

```bash
cd battles/nightshift-bash
./gameday.sh doctor
./gameday.sh start team1
./gameday.sh shell team1
```

Inside the container, read `/srv/nightshift/START-HERE.md`. Participant content is Japanese in this first release. Image construction requires network access; the running exercise container has no network access.

After collecting evidence, exit and run:

```bash
./gameday.sh submit team1
./gameday.sh repair team1 --yes
./gameday.sh shell team1
```

Repair as `operator`, then exit and score:

```bash
./gameday.sh score team1
./gameday.sh score team1 --json
```

Scoring actually restarts the **batch service**, not the operating system. Stop editing during scoring. Security probes temporarily replace an auditor-writable command and restore its previous content and permissions where possible. Probe orders and logs remain in the exercise.

## Scoring

Discovery: 300 points. Repair: 400 points. Valid processing, idempotency, and malformed-input rejection: 300 points. Deployment alone earns zero. Discovery freezes when repair begins; repair and service points reflect current checks rather than permanent achievements. Output checks include a per-run key-dependent checksum, zero-price orders, and zero-padded decimal inputs.

## Teardown and tests

```bash
./gameday.sh down team1 --yes
./gameday.sh test
```

Reset is explicit and destructive: `./gameday.sh reset team1 --yes`. It replaces all progress with a fresh exercise. The Docker image remains after teardown.

An optional Linux-root test backend is `sudo bash tests/run.sh namespace`. It uses disposable rootfs copies and user/mount/PID/network namespaces; it does not create users on the host. It is not a Docker emulator or a supported replacement for the interactive Docker launcher.

## Verification status

Docker build and the full integration suite passed on 2026-09-27 using Docker 29.6.1 on macOS/Colima: **33 assertions**, including a reference repair scoring **1000/1000** and two actual batch-service restarts. The application tmpfs explicitly allows execution of the exercise scripts; `/run` and `/tmp` remain `noexec`. The earlier Linux namespace results are retained in `docs/VERIFICATION.md`; current evidence and untested boundaries are in [PR verification](docs/PR-VERIFICATION.md).

This package is **not integrated with TenkaCloud**. `docs/TENKACLOUD.md` describes the missing trusted host adapter; the score JSON is a standalone contract, not a supported TenkaCloud `/verify` response.

## Trust boundary

The host CLI, `.state`, grader, and reference solutions are organizer-only. Participants receive only non-root shells in their disposable container. Running everything as one host user is self-study, not a cheat-resistant competition. The image excludes organizer/test files. Its immutable supervisor drops to the correct UID before running editable code.

Containers run with no network, no host bind mounts, no Docker socket, a read-only root, and resource limits. This is not a claim of absolute isolation against hostile code. Use disposable dedicated hosts/VMs and rehearse before inviting untrusted users. See `docs/SECURITY.md`.

Original training material inspired by the published topic list of *Black Hat Bash* / 『侵入技術入門』. No book text or sample code was copied. No publisher/author affiliation or endorsement is implied.

Apache-2.0; see [the repository license](../../LICENSE).
