# TenkaCloudChallenge

> 日本語版: [README.ja.md](./README.ja.md)

This repository is the public problem catalog for the [TenkaCloud](https://github.com/susumutomita/TenkaCloud) platform. It contains the problem payloads that the platform packages and deploys; the platform repository owns deployment, scoring dispatch, and integration.

## Catalog layout

- [`challenges/`](./challenges/) contains self-paced problems.
- [`battles/`](./battles/) contains head-to-head problems.
- Each problem owns its `metadata.json` and runtime artifacts (`template.yaml`, `local/`, portal components, or services as applicable).
- [`runtimes/`](./runtimes/) contains runtime implementations genuinely shared by multiple problems. StackStack is one such family; problem-specific code still belongs inside its problem directory.
- [`SCHEMA.json`](./SCHEMA.json) and [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json) define the catalog contracts.

## Validation

```bash
make install
make agent-gate
```

The root validator checks metadata, required bilingual READMEs, simulation overlays, and catalog cross-references. The pull-request CI runs only this lightweight validation. Runtime code and participant-facing tests stay with the problem that owns them and should be run when that problem changes.

Do not expose secrets, flags, hidden checks, or reference answers on participant-visible surfaces. Deployment, production operations, and platform integration remain the responsibility of the TenkaCloud repository.

The catalog is licensed under Apache-2.0.
