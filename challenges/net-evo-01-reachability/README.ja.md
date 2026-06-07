# インターネット進化史 Ep01 — 届かないパケット

> English: [README.md](./README.md)
> **インターネット進化史** シリーズの 1 話。 各話は「インターネットがどう進化したか」の 1 場面を、 TCP/IP の層を *暗記する* のではなく *自分で操作する* ことで追体験する。

天下クラウド株式会社、 ネットワーク班に異動初日。 加藤さんが残した社内ツールは 2 つのサブネットに分かれて動いていた ── はずだった。

> 佐々木 CTO 曰く: 「踏み台 (`relay`) からは入れる。 でも奥の管理ノード (`core`) に誰も届かない。 ファイアウォールは開けたって加藤は言ってた。 なのに繋がらない。 エラーすら出ない、 ただ無言で固まる」

インターネットの語源は inter-network ── バラバラの網を相互接続すること。 君の仕事はまさにそれ。 なぜパケットが片道で消えるのかを突き止め、 経路を直して `core` が握るフラグを取り出せ。

## これはクイズではない

フラグは暗記して打ち込む概念名ではない。 deploy ごとにランダム生成され、 **`core` だけが知っている値**で、 ネットワークを実際に直すまで到達できない private ホストが HTTP で配っている。 答えを「思い出す」のではなく、 AWS を「操作して」手に入れる。

## デプロイされるもの

CloudFormation 1 スタック (全リソース CFn 管理下 → `delete-stack` で完全消去):

```text
            VPC 10.20.0.0/16
┌───────────────────────────┬───────────────────────────┐
│  public subnet 10.20.1.0/24│  private subnet 10.20.2.0/24│
│  ┌──────────┐              │            ┌──────────┐    │
│  │  relay   │  SSM ◄───────┼── あなた    │   core   │    │
│  │ (踏み台) │  ── curl ───►│  :8080 ────► (フラグ)  │    │
│  └──────────┘              │      ▲     └──────────┘    │
│   IGW ルート                │      │  Network ACL が    │
│                            │      │  「戻り」を落とす   │
└───────────────────────────┴──────┴────────────────────┘
```

- `relay` — t3.micro, public サブネット, **SSM Session Manager** で接続 (SSH 鍵不要・inbound ポート不要)。
- `core` — t3.micro, private サブネット, **public IP なし**, `:8080` で per-deploy のフラグを配る。
- Security Group × 2 (正常), private サブネットの Network ACL × 1 (**仕込んだ罠**)。

NAT Gateway / EIP なし。 45 分で **約 $0.02**。

## 遊び方

1. **`relay` に入る** (Session Manager):
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay の instance id>
   ```
2. **`relay` の中から `core` に到達を試みる:**
   ```bash
   curl -v --max-time 5 http://<core の private ip>:8080
   ```
   **ハングする** (タイムアウト) ── 「接続拒否 (refused)」ではない。 この違いが問題の核心。 行きは届いているのに戻りが来ていない。
3. **到達性の 4 層を 1 枚ずつ剥がす** (`describe-*`):
   - `core` の Security Group → `relay` から 8080 を許可、 かつ **ステートフル** (戻りは自動許可)。 犯人ではない。
   - ルートテーブル → 同一 VPC, local ルートで届く。 犯人ではない。
   - サブネット → 同一 VPC。 犯人ではない。
   - private サブネットの **Network ACL** → これを読む。 NACL は **ステートレス** ── inbound と outbound が別物で、 戻り通信は自動許可されない。
4. **抜けている 1 ルールを追加** (新規リソースではなく、 既存 NACL の設定変更):
   ```bash
   aws ec2 create-network-acl-entry --network-acl-id <PrivateNaclId> \
     --rule-number 110 --protocol 6 --egress \
     --cidr-block 10.20.1.0/24 --port-range From=1024,To=65535 --rule-action allow
   ```
5. **もう一度 `core` へ** ── 今度はフラグ `TC{...}` が返る。 Portal に submit。

## 採点

- 正解: **+300 pt** (1 デプロイにつき 1 回)。
- 不正解: **−15 pt** /回 (0 未満にはならない)。
- 段階ヒントは点数ペナルティ付き (`metadata.json` 参照)。

## コスト

t3.micro × 2 台で約 45 分 ≈ **$0.02**。 NAT / EIP なし。 `aws cloudformation delete-stack` で撤収 ── 全部 CloudFormation が作ったので、 孤児リソースは 1 つも残らない。

## 設計メモ (作問者向け)

この問題はカタログが向かっている 3 原則のリファレンス実装:

1. **発見型フラグ** ── フラグは deploy ごとのランダム値で、 意図した AWS 操作をして初めて到達できる。 暗記では解けない。
2. **設定変更で直す・手で新規作成しない** ── テンプレが壊れた状態でリソースを作り、 解法は既存リソースの *変更* (NACL エントリ 1 つ)。 参加者はトップレベルリソースを作らないので `delete-stack` で完全クリーンアップ (CFn 管理外の孤児ゴミが残らない)。
3. **本物の「気づき」** ── ステートフル SG / ステートレス NACL / ハング vs 拒否 の区別は、 答えを読むのではなくパケットを流して体得する実運用スキル。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 正本 (カタログ + 採点 + ヒント)
- [`template.yaml`](./template.yaml) — ペライチ CFn テンプレート (デプロイ本体)
