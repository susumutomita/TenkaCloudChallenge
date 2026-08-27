# TenkaCloudChallenge

> English: [README.md](./README.md)

これは [TenkaCloud](https://github.com/susumutomita/TenkaCloud) プラットフォーム向けの公開問題カタログです。プラットフォームがpackage・deployする問題payloadを管理し、deploy・採点dispatch・platform integrationはTenkaCloud本体が管理します。

## カタログ構造

- [`challenges/`](./challenges/) は個別演習です。
- [`battles/`](./battles/) は対戦形式の問題です。
- 各問題は `metadata.json` とruntime artifact（`template.yaml`、`local/`、portal component、serviceなど）を所有します。
- [`stackstack-base/`](./stackstack-base/) はStackStack問題群が共有するruntimeです。
- [`SCHEMA.json`](./SCHEMA.json) と [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json) がcatalog contractを定義します。
- [`index.json`](./index.json) と [`cost-report.json`](./cost-report.json) はdownstream toolingが利用する生成物です。

## 検証

```bash
bun install --frozen-lockfile --ignore-scripts
bun run validate
```

root validatorはmetadata、日英README、simulation overlay、catalog cross-referenceを検証します。PRのCIが実行するのはこの軽量な検証だけです。runtime codeとparticipant向けtestは、それを所有する問題の中に置き、その問題を変更するときに実行します。

問題を追加・変更した後は機械向けcatalogを再生成します。

```bash
bun run reindex
```

secret、flag、hidden check、reference answerをparticipant-visible surfaceへ漏らさないでください。deploy、production operation、platform integrationはTenkaCloud repositoryの責務です。

このcatalogはApache-2.0 licenseです。
