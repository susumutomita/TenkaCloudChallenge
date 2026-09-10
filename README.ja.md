# TenkaCloudChallenge

> English: [README.md](./README.md)

これは [TenkaCloud](https://github.com/susumutomita/TenkaCloud) プラットフォーム向けの公開問題カタログです。プラットフォームがpackage・deployする問題payloadを管理し、deploy・採点dispatch・platform integrationはTenkaCloud本体が管理します。

## まず1問体験

暗号の予備知識なしで始められる[1問体験ガイド](battles/ac26-crypto-battle/FIRST-EXPERIENCE.md)へ。紙とペン、中学数学で暗号配送を体験できます。練習は得点・締切なし。運営者からの招待で参加する方法と、自分の端末でプレビューする方法、次の問題への進み方を案内します。公開済みの体験サービスではありません。

## カタログ構造

- [`challenges/`](./challenges/) は個別演習です。
- [`battles/`](./battles/) は対戦形式の問題です。
- 各問題は `metadata.json` とruntime artifact（`template.yaml`、`local/`、portal component、serviceなど）を所有します。
- [`runtimes/`](./runtimes/) は複数問題が同一実装を共有するときだけ使うruntime置き場です。StackStackはその1 familyで、問題固有コードは各問題ディレクトリに置きます。
- [`SCHEMA.json`](./SCHEMA.json) と [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json) がcatalog contractを定義します。

## 検証

```bash
make install
make agent-gate
```

root validatorはmetadata、日英README、simulation overlay、catalog cross-referenceを検証します。PRのCIが実行するのはこの軽量な検証だけです。runtime codeとparticipant向けtestは、それを所有する問題の中に置き、その問題を変更するときに実行します。

secret、flag、hidden check、reference answerをparticipant-visible surfaceへ漏らさないでください。deploy、production operation、platform integrationはTenkaCloud repositoryの責務です。

このcatalogはApache-2.0 licenseです。
