# TenkaCloudChallenge

[English](README.md)

[TenkaCloud](https://github.com/susumutomita/TenkaCloud) 向けの公開問題カタログです。個別演習とチーム対戦の問題文、実行に必要なファイル、テストを管理します。

## 問題を探す

| ディレクトリ | 内容 |
| --- | --- |
| [challenges/](challenges/) | 個別に取り組む演習 |
| [battles/](battles/) | チームで競う対戦問題 |

各問題のREADMEに、シナリオ・前提知識・確認方法があります。`metadata.json`には実行環境、採点方法、カタログ上の状態を定義します。イベントで使える問題はプラットフォームの対応と運営者の選択によって決まります。掲載されている全問題を実イベントで検証済みという意味ではありません。

イベントの開催やプラットフォームのローカル起動は、[TenkaCloudのセットアップガイド](https://github.com/susumutomita/TenkaCloud/blob/main/README.ja.md#クイックスタート)を参照してください。

## 問題を追加・修正する

[作成ルール](AGENTS.md)に従い、問題ごとのディレクトリに、メタデータ・日英README・実行コード・検証用データ・テストをまとめます。実行環境と採点方法が近い既存問題を出発点にしてください。

- [SCHEMA.json](SCHEMA.json)：問題メタデータの形式
- [SIMULATION_SCHEMA.json](SIMULATION_SCHEMA.json)：シミュレーション設定の形式
- [runtimes/](runtimes/)：複数の問題が同じ実装を共有する場合の置き場

デプロイ、認証、採点の呼び出し、参加者・管理者画面はTenkaCloud本体が担当します。このリポジトリは問題内容を担当します。参加者向けファイルやイメージに秘密値や模範解答を含めないでください。

## 変更を検証する

```bash
make install
make agent-gate
```

メタデータ、日英READMEの有無、シミュレーション設定、カタログ内の参照を検証します。加えて、変更した問題のREADMEにあるテストを実行してください。CIでは変更内容に応じてゲームや容量の検証も選択されます。カタログ検証だけでは、実行時の動作や実環境へのデプロイは確認できません。

## ライセンス

[Apache-2.0](LICENSE)。
