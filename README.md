# TenkaCloudChallenge

> 日本語版: [README.ja.md](./README.ja.md)

This repository is the public problem catalog for the [TenkaCloud](https://github.com/susumutomita/TenkaCloud) platform. It contains the problem payloads that the platform packages and deploys; the platform repository owns deployment, scoring dispatch, and integration.

## Catalog layout

- [`challenges/`](./challenges/) contains self-paced problems.
- [`battles/`](./battles/) contains head-to-head problems.
- Each problem owns its `metadata.json` and runtime artifacts (`template.yaml`, `local/`, portal components, or services as applicable).
- [`stackstack-base/`](./stackstack-base/) is the shared runtime used by the StackStack problem family.
- [`SCHEMA.json`](./SCHEMA.json) and [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json) define the catalog contracts.
- [`index.json`](./index.json) and [`cost-report.json`](./cost-report.json) are generated catalog artifacts consumed by downstream tooling.

## Validation

```bash
bun install --frozen-lockfile --ignore-scripts
bun run validate
```

The root validator checks metadata, required bilingual READMEs, simulation overlays, and catalog cross-references. The pull-request CI runs only this lightweight validation. Runtime code and participant-facing tests stay with the problem that owns them and should be run when that problem changes.

After adding or changing a problem, regenerate the machine-readable catalog:

```bash
bun run reindex
```

Do not expose secrets, flags, hidden checks, or reference answers on participant-visible surfaces. Deployment, production operations, and platform integration remain the responsibility of the TenkaCloud repository.

The catalog is licensed under Apache-2.0.
