# インターネット進化史 Ep03 — 電話できない奥の部屋

> English: [README.md](./README.md)
> **インターネット進化史** シリーズの 3 話。 各話は「インターネットがどう進化したか」の 1 場面を、 TCP/IP の層を *暗記する* のではなく *自分で操作する* ことで追体験する。

天下クラウド株式会社、 ネットワーク班 3 日目。 加藤さんが残した監視ジョブは、 private サブネットの管理ノード `core` から「外」に問い合わせて結果を持ち帰る ── はずだった。

> 佐々木 CTO 曰く: 「`core` が外に出られない。 ライセンス確認も、 アップデートも、 何も取りに行けない。 IPv4 が枯れてから NAT で逃がす設計にしたって加藤は言ってた。 踏み台 (`relay`) は普通に外に出られるのに、 奥の `core` だけが沈黙してる」

IPv4 アドレスが枯渇し、 世界は **private アドレス + NAT** で『1 つのグローバル IP の後ろに大量のホストを隠して外に出す』時代へ進化した。 君の仕事はその出口を直すこと。 なぜ `core` だけ外に出られないのかを突き止め、 出口を開通させて `core` が握るフラグを取り出せ。

## これはクイズではない

フラグは暗記して打ち込む概念名ではない。 deploy ごとにランダム生成され、 `core` が **NAT 経由で外に出てインターネットを往復して初めて取得できる** 値。 egress を実際に直すまで `core` は `NO EGRESS` としか返さず、 写し取れるものは何も無い。 答えを「思い出す」のではなく、 AWS を「操作して」手に入れる。

## デプロイされるもの

CloudFormation 1 スタック (全リソース CFn 管理下 → `delete-stack` で完全消去):

```text
                         VPC 10.30.0.0/16
┌─────────────────────────────────────┬─────────────────────────────┐
│  public サブネット 10.30.1.0/24      │  private サブネット 10.30.2.0/24 │
│  ┌──────────┐   ┌──────────┐         │           ┌──────────┐       │
│  │  relay   │   │   nat    │── IGW ──┼──► 外      │   core   │       │
│  │ (踏み台) │   │MASQUERADE│◄────────┼── フラグ ──│(public無)│       │
│  └────┬─────┘   └────▲─────┘         │     ▲      └────┬─────┘       │
│   SSM │ あなた       │ デフォルトルート│     │ curl :8080 (NO EGRESS) │
│       └── curl :8080 ─────────────────┼─────┘           │            │
│                      ╳ 欠落: private RT の 0.0.0.0/0 → nat            │
└─────────────────────────────────────┴─────────────────────────────┘
```

- `nat` — t3.micro, public サブネット, **SourceDestCheck 無効** + UserData の `iptables` **MASQUERADE**。 自前の NAT (NAT Gateway なし・EIP なし ── 自動付与の public IP をそのまま使う)。 `:80` でフラグも配るが、 これは外に出られるホストからしか届かない。
- `relay` — t3.micro, public サブネット, **SSM Session Manager** で接続 (SSH 鍵不要・inbound ポート不要)。
- `core` — t3.micro, private サブネット, **public IP なし**。 15 秒ごとに NAT の public IP からフラグ取得を再試行し、 結果を `:8080` で配る (egress 復旧まで `NO EGRESS`)。
- Security Group × 3 (全部正常)、 そして **デフォルトルートが欠落した** private ルートテーブル (**仕込んだ罠**)。

NAT Gateway / EIP なし。 t3.micro × 3 台で 1 時間 **約 $0.04**。

## 遊び方

1. **`relay` に入る** (Session Manager):
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay の instance id>
   ```
2. **`relay` の中から `core` に到達を試みる:**
   ```bash
   curl --max-time 5 http://<core の private ip>:8080
   ```
   **`NO EGRESS`** が返る ── `core` は起動して応答しているが、 外に出られないので配るフラグが無い。 これが問題の核心。 SG は開いていて、 NAT も健康なのに、 `core` だけが外に出られない。
3. **層を 1 枚ずつ剥がす** (`describe-*`) ── なぜ `relay` は外に出て `core` は出られないのか:
   - `core` の Security Group → egress は開いている。 犯人ではない。
   - NAT インスタンス → `nat` は **SourceDestCheck 無効** + `iptables` MASQUERADE で動いている。 健康。 犯人ではない。
   - **ルートテーブル** → 両方を見比べる:
     ```bash
     aws ec2 describe-route-tables \
       --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
       --query 'RouteTables[].{Id:RouteTableId,Routes:Routes}'
     ```
     **public** には `0.0.0.0/0 → igw-…` がある。 **private** には `local` ルートしか無く、 **デフォルトルートが無い**。 デフォルトルートの無い private ホストは、 外向きパケットの行き先が無い。
4. **欠落した 1 ルートを追加** (新規リソースではなく、 既存ルートテーブルへのルート追加):
   ```bash
   aws ec2 create-route --route-table-id <PrivateRouteTableId> \
     --destination-cidr-block 0.0.0.0/0 \
     --instance-id <NatInstanceId>
   ```
   `NatInstanceId` は CFn Output (または `describe-instances` で `${NamePrefix}-nat` を探す)。 NAT の ENI を `--network-interface-id <eni-…>` で指定してもよい。
5. **もう一度 `core` へ** ── `core` のループは 15 秒ごとに egress を再試行しているので、 10〜20 秒待ってから:
   ```bash
   curl http://<core の private ip>:8080
   ```
   今度は `core` が NAT 経由で外に出てフラグを取得済みで、 `TC{...}` が返る。 Portal に submit。

## 採点

- 正解: **+300 pt** (1 デプロイにつき 1 回)。
- 不正解: **−15 pt** /回 (0 未満にはならない)。
- 段階ヒントは点数ペナルティ付き (`metadata.json` 参照)。

## コスト

t3.micro × 3 台で約 1 時間 ≈ **$0.04**。 **NAT Gateway / EIP なし** ── NAT は自動付与の public IP を使う普通の EC2 なので、 これが課金を数セントに抑える鍵。 `aws cloudformation delete-stack` で撤収 ── 全部 CloudFormation が作ったので、 孤児リソースは 1 つも残らない。

## 設計メモ (作問者向け)

この問題は Ep01 と同じ 3 原則を、 egress / ルーティング層に適用したもの:

1. **発見型フラグ** ── フラグは NAT のインターネット側に置かれ、 *NAT 経由の正常な経路でしか* 届かない。 デフォルトルートが無い限り `core` は取得できず (= 配れない)。
2. **設定変更で直す・手で新規作成しない** ── テンプレは private ルートテーブルを壊れた状態 (デフォルトルート欠落) でデプロイし、 解法は既存テーブルへの *ルート 1 本追加* (`ec2:CreateRoute`)。 参加者はトップレベルリソースを作らないので `delete-stack` で完全クリーンアップ (CFn 管理外の孤児ゴミが残らない)。
3. **本物の「気づき」** ── IPv4 枯渇 → NAT という進化こそ、 private サブネットが NAT へのデフォルトルートを必要とする理由。 外に電話できない private ホストを 1 ルートで救うのは、 実運用そのもののスキル。

フラグ文字列は各インスタンスの UserData を経由するため、 参加者ロールは `ec2:DescribeInstanceAttribute` を明示的に **Deny** している ── フラグへの唯一の道は egress を復旧して `core` から読むこと。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 正本 (カタログ + 採点 + ヒント)
- [`template.yaml`](./template.yaml) — ペライチ CFn テンプレート (デプロイ本体)
