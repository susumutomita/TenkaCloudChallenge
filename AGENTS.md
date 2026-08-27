# AGENTS.md — TenkaCloudChallenge

TenkaCloudChallenge owns public problem payloads, metadata, runtime artifacts, shared problem runtimes, and generated catalog artifacts. TenkaCloud owns deployment, scoring dispatch, compatibility comparison, and platform integration.

## Guardrails

- Do not expose credentials, secrets, flags, hidden checks, or reference answers on participant-visible surfaces.
- Treat schema, scoring, cost, security, and compatibility semantics as high-impact contracts.
- Keep runtime code and runtime tests inside the problem that owns them. Do not add problem-specific test suites under root `scripts/`.
- Update `index.json` and `cost-report.json` with `bun run reindex`; do not hand-edit them.
- Do not run deploy, destroy, release, or production cloud commands from this repository.

## Verification

Run the shared catalog gate:

```bash
make agent-gate
```

This validates metadata, bilingual READMEs, simulation overlays, and cross-references. If a problem runtime changes, also run that problem's documented local/public tests.
