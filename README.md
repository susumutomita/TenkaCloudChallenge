# TenkaCloudChallenge

[日本語](README.ja.md)

The public problem catalog for [TenkaCloud](https://github.com/susumutomita/TenkaCloud). It contains individual exercises and team competitions, with each problem's instructions, runtime artifacts and tests.

## Find a problem

| Directory | What it contains |
| --- | --- |
| [challenges/](challenges/) | Individual exercises |
| [battles/](battles/) | Team competitions |

Start with a problem's README for its scenario, prerequisites and verification steps. Its `metadata.json` declares the runtime, scoring contract and catalog status. Availability in an event depends on the platform and the organizer's selection; inclusion here does not mean every problem has been tested in a live event.

To run an event or start the platform locally, follow the [TenkaCloud setup guide](https://github.com/susumutomita/TenkaCloud#quickstart).

For a beginner team event: [Office Link](battles/office-link-battle/README.md) — five real AWS preparation missions, an existing Gate, then an uptime recovery Battle. Four people per team; host-selected extra service Challenges are separate. See the [host runbook](battles/office-link-battle/OPERATOR.md).

## Add or update a problem

Follow the [authoring contract](AGENTS.md). Keep a problem's metadata, bilingual READMEs, runtime, fixtures and tests in its own directory. Start from a problem with the same runtime and scoring contract.

- [SCHEMA.json](SCHEMA.json) defines problem metadata.
- [SIMULATION_SCHEMA.json](SIMULATION_SCHEMA.json) defines simulation overlays.
- [runtimes/](runtimes/) holds implementations shared unchanged by multiple problems.

TenkaCloud owns deployment, authentication, scoring dispatch and the participant/admin applications. This repository owns the problem content. Keep secrets and reference answers out of participant-visible files and images.

## Validate changes

```bash
make install
make agent-gate
```

This checks metadata, bilingual README presence, simulation overlays and catalog cross-references. Run the affected problem's own tests as documented in its README as well. CI selects additional game and capacity checks for relevant code changes; catalog validation alone does not prove runtime behavior or live deployment.

## License

[Apache-2.0](LICENSE).

## Public author credits

Problem metadata may include optional `authors` in display order:

```json
{
  "authors": [
    { "name": "Your public name", "profileUrl": "https://example.com/profile" },
    { "name": "共同作者" }
  ]
}
```

`name` is a nonblank public display name. `profileUrl` is optional and must be an
absolute HTTP(S) URL without credentials, whitespace or backslashes. Multiple
authors are supported. Omit `authors` (or use `[]`) to keep existing uncredited
behavior. Use only credits each author explicitly wants published; never infer
names or emails from Git history. Credits are public display data, including for
private problems shown to authorized participants, and confer no permissions or
verified identity. Public discovery continues to exclude private problems.
