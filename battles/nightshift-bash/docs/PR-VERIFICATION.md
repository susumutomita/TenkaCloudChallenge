# PR verification — 2026-09-27

Base: `susumutomita/TenkaCloudChallenge` main at `5704cee278ede234c103e8fe5c9a6e1eb7d8bb1f`.

## Executed on macOS with Colima / Docker 29.6.1

- Reproduced the Docker CI failure: the auditor-created command could not execute on the application tmpfs. Docker mounts tmpfs with `noexec` unless overridden.
- Enabled `exec` only for `/srv/nightshift`, which intentionally contains executable exercise scripts. Kept `nosuid`, `nodev`, read-only rootfs, network isolation, and `/run` and `/tmp` `noexec`.
- `make syntax`: passed for all Bash scripts and executables.
- `bash tests/run.sh docker`: **33/33 passed**, using the real Docker build and runtime. Reference repair reached **1000/1000**, including two batch-service restarts. The grader rejects deleted keys, disabled processing, forged score files, and repairs that regress on restart.
- CLI `doctor`, `start`, initial `score --json`, and an interactive `shell` were exercised. The participant reads `START-HERE.md` as UID 1100 (`auditor`), not root. `repair` switched new shells to UID 1200 (`operator`); `down` removed only the verification container and its state.
- `make agent-gate`: all 126 existing metadata records passed. This validates the existing catalog, not native support for this unregistered pack.

Earlier Linux namespace verification (33 assertions) remains in `pr-namespace-test.log` and `VERIFICATION.md` as historical evidence.

## Scope and untested boundaries

This is a standalone CLI pack. It does not register a Portal problem or provide platform scoring, authenticated terminal delivery, or English participant statements. See `TENKACLOUD.md`.

WSL2, a concurrent multi-team event, and first-time participants completing the exercise were not tested. Those are optional event rehearsals; the Docker integration test is the reproducible runtime check for this PR.
