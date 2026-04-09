# TenkaCloudChallenge

TenkaCloud プラットフォームで使用する競技問題ライブラリ。

> **このリポジトリはプライベート管理です。** 問題の答えや脆弱性の詳細が含まれるため、参加者には公開しないでください。

## 構成

```
problems/
├── gameday/          # GameDay 形式（攻撃・防御型競技）
│   └── {problem}/
│       ├── README.md
│       ├── cloudformation/   ← CFn 1 枚でデプロイ
│       ├── api/              ← サーバーサイドコード
│       ├── frontend/         ← 静的サイト
│       └── scripts/deploy.sh
└── jam/              # JAM 形式（構築型）
    ├── core/         # 基本問題セット（20 問）
    └── generated/    # バリアントセット（80 問）
        └── {problem}/
            ├── README.md
            ├── problem.yaml
            ├── cloudformation/
            └── scripts/deploy.sh
```

## 問題のデプロイ

各問題は `./scripts/deploy.sh` で独立してデプロイできます。

```bash
# GameDay (Security Battle Royale) — チーム環境を一括作成
cd problems/gameday/security-battle-royale
export VPC_ID=vpc-xxx SUBNET1=subnet-xxx SUBNET2=subnet-yyy
TEAMS="team01 team02 team03" ./scripts/deploy.sh

# JAM 問題
cd problems/jam/core/s3-secure-bucket
STACK_NAME=my-stack AWS_REGION=us-east-1 ./scripts/deploy.sh
```

## 新しい問題の追加

TenkaCloud リポジトリで `/create-problem` スキルを使うと標準構造の雛形が生成されます。

## 関連リポジトリ

- [TenkaCloud](https://github.com/susumutomita/TenkaCloud) — プラットフォーム本体（公開）
