# AGENTS.md — TenkaCloudChallenge

TenkaCloudChallenge の AI エージェント向け作業契約です。問題作成の方法は固定せず、repository boundary、安全、検証可能な完了条件を共有します。

## Repository boundary

TenkaCloudChallenge は problem content、learning material、scenario、metadata、template、local workload、grading、catalog index を所有します。

- 必要な simulator capability を宣言するが、Simulator の実装は置かない。
- TenkaCloudSimulator は capability 実装を所有し、problem ID や問題固有分岐を持たない。
- TenkaCloud は compatibility comparison と platform integration を所有する。
- participant-visible secret、flag、reference solution を公開 surface へ漏らさない。

## Working contract

- 依頼、Issue、schema、既存 problem、validator、generated artifact から受け入れ条件を把握する。
- 新しい problem または helper を足す前に、既存 catalog、shared script、cost rule、compatibility contract を検索する。
- 方法はタスクに合わせて選ぶ。`Plan.md`、固定 workflow、専用 Skill、固定人数の subagent は必須ではない。
- problem content、template、portal、grading、local workload、generated catalog を必要な範囲で一貫させる。
- scope 外の発見は PR に混ぜず、必要なら別 Issue または PR の known limitation として残す。専用 follow-up Skill は任意。
- deploy、destroy、release、production cloud command は実行しない。

## Guardrails

- AWS credential、`.env`、secret、flag、participant-visible answer を読み出したり公開したりしない。
- shared schema、grading semantics、cost rule、security rule、compatibility semantics は高影響の contract として扱う。
- generated `index.json`、`cost-report.json` は generator から更新し、手編集しない。
- test、validator、schema、cost check、compatibility check を通すためだけに弱めない。検出器が誤っている証拠がある場合は、fixture と test を伴って修正してよい。
- skipped / focused test、placeholder、silent fallback を残さない。

## Verification

完了の正本は repository-local gate です。

```bash
make agent-gate
```

Simulator capability contract を変更した場合、clean checkout を使う cross-repository scan も必要です。

```bash
make simulator-compatibility SIMULATOR_CHECKOUT=/absolute/path/to/TenkaCloudSimulator
```

変更に応じて metadata、CloudFormation、container starter / reference / mutation / `/verify`、cost、course drift、generated artifact を実際の validator で確認します。既存テストが十分なら、儀式として重複テストを追加しません。

PR 本文には変更内容、検証結果、risk、TenkaCloud / Simulator / Passport への影響、未検証事項を書く。
