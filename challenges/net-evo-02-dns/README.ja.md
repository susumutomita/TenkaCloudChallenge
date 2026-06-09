# インターネット進化史 Ep02 — 名前が指す先

> English: [README.md](./README.md)
> **インターネット進化史** シリーズの 2 話。 各話は「インターネットがどう進化したか」の 1 場面を、 TCP/IP の層を *暗記する* のではなく *自分で操作する* ことで追体験する。

天下クラウド株式会社、 ネットワーク班に来て数週間。 加藤さんは去り際に「IP 直書きはもうやめた。 これからは名前で繋ぐ」と言い残していった。 そのやり方で組み直された社内サービスが、 今朝から繋がらない。

> 佐々木 CTO 曰く: 「監視ダッシュボードが `core` を見失ってる。 踏み台 (`relay`) からは名前で呼んでるはずだ ── `core.internal.tenka.test` だったか。 名前は引けてる、 IP も返ってくる。 なのに繋がらない。 加藤の置き土産が壊れてるのか、 そもそも嘘の名前なのか、 君が見極めてくれ」

インターネットは手書きの `hosts.txt` から **DNS** へ進化した ── *名前* と *住所* (IP) を分離し、 住所が変わっても名前を変えずに済むようにした発明だ。 だが、 その名前が *間違った住所* を指していたら? 君の仕事は、 名前が指す先を本物の `core` に向け直し、 `core` が握るフラグを取り出すことだ。

## これはクイズではない

フラグは暗記して打ち込む概念名ではない。 deploy ごとにランダム生成され、 **`core` だけが知っている値**で、 名前が本物の `core` を指すように直すまで到達できない private ホストが HTTP で配っている。 答えを「思い出す」のではなく、 AWS を「操作して」手に入れる。

## デプロイされるもの

CloudFormation 1 スタック (全リソース CFn 管理下 → `delete-stack` で完全消去):

```text
            VPC 10.30.0.0/16   ── private hosted zone: internal.tenka.test
┌───────────────────────────┬─────────────────────────────┐
│  public subnet 10.30.1.0/24│  private subnet 10.30.2.0/24 │
│  ┌──────────┐              │            ┌──────────┐     │
│  │  relay   │  SSM ◄───────┼── あなた    │   core   │     │
│  │ (踏み台) │  curl core.internal… ───► │  :8080   │     │
│  └────┬─────┘              │      ▲     └──────────┘     │
│       │ DNS に訊く:        │      │  だが core の A レコード│
│       │ "core.internal…?"  │      │  は偽 IP を答える       │
│       └──► 192.0.2.10 (死)  │     │  (192.0.2.10)          │
└───────────────────────────┴──────┴─────────────────────┘
```

- `relay` — t3.micro, public サブネット, **SSM Session Manager** で接続 (SSH 鍵不要・inbound ポート不要)。
- `core` — t3.micro, private サブネット, **public IP なし**, `:8080` で per-deploy のフラグを配る。
- private **Route 53 Hosted Zone** `internal.tenka.test` (VPC に紐付け済み) と、 その中の A レコード 2 つ:
  - `relay.internal.tenka.test` → relay の *正しい* private IP (おとり ── ゾーンが生きて答えている証拠)。
  - `core.internal.tenka.test` → **間違った IP** (`192.0.2.10`、 RFC 5737 のテスト用アドレスで決して生きたホストにならない) ── **仕込んだ罠**。
- Security Group × 2 とネットワーク経路は **正常**。 故障は純粋に DNS だけにある。

NAT Gateway / EIP なし。 45〜60 分で **約 $0.02** (private Hosted Zone は $0.50/月だが 1 セッション分なら数セント)。

## 遊び方

1. **`relay` に入る** (Session Manager):
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay の instance id>
   ```
2. **`relay` の中から `core` を名前で呼ぶ:**
   ```bash
   curl -v --max-time 5 http://core.internal.tenka.test:8080
   ```
   **名前は解決する** (curl が接続先 IP を表示する) **のにハングする** ── 「名前が引けない (NXDOMAIN)」でも「接続拒否 (refused)」でもない。 この違いが問題の核心。 答えは返ってくるのに、 その答えが間違ったホストを指している。
3. **名前が返す IP と core の実際の場所を突き合わせる:**
   ```bash
   dig core.internal.tenka.test +short          # または: getent hosts core.internal.tenka.test
   # -> 192.0.2.10   (RFC 5737 の死んだテスト IP)
   ```
   そして `core` の **本当の** private IP を調べ、 食い違いに気づく:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     "Name=tag:Name,Values=<NamePrefix>-core" \
     --query 'Reservations[].Instances[].PrivateIpAddress'
   ```
4. **Hosted Zone を読み**、 偽レコードを確認する:
   ```bash
   aws route53 list-hosted-zones --query "HostedZones[?Name=='internal.tenka.test.'].Id"
   aws route53 list-resource-record-sets --hosted-zone-id <PrivateHostedZoneId>
   ```
5. **A レコードを 1 つ UPSERT** して、 名前を本物の `core` に向け直す (既存ゾーンの設定変更 ── 新規リソースは作らない):
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id <PrivateHostedZoneId> \
     --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
       "Name":"core.internal.tenka.test","Type":"A","TTL":60,
       "ResourceRecords":[{"Value":"<core の本当の private IP>"}]}}]}'
   ```
6. **TTL 分待ってから** (resolver キャッシュが切れるまで最大 60 秒)、 **もう一度 `core` を名前で呼ぶ** ── 今度は名前が本物のホストを指し、 フラグ `TC{...}` が返る。 Portal に submit。

## 採点

- 正解: **+300 pt** (1 デプロイにつき 1 回)。
- 不正解: **−15 pt** /回 (0 未満にはならない)。
- 段階ヒントは点数ペナルティ付き (`metadata.json` 参照)。

## コスト

t3.micro × 2 台で約 45〜60 分 ≈ **$0.02**。 private Hosted Zone は $0.50/月 (1 セッション分なら数セント)。 NAT / EIP なし。 `aws cloudformation delete-stack` で撤収 ── 全部 CloudFormation が作ったので、 孤児リソースは 1 つも残らない。

## 設計メモ (作問者向け)

この話もシリーズが拠って立つ 3 原則を守っている:

1. **発見型フラグ** ── フラグは deploy ごとのランダム値で、 名前が本物の `core` を指すように直して初めて到達できる。 暗記では解けない。
2. **設定変更で直す・手で新規作成しない** ── テンプレは間違った A レコードでゾーンを作り、 解法は既存レコードの *UPSERT* (`route53:ChangeResourceRecordSets`)。 参加者はトップレベルリソースを作らない (`CreateHostedZone` は与えない) ので `delete-stack` で完全クリーンアップ。
3. **本物の「気づき」** ── NXDOMAIN / refused / *正しく引けるが誤った IP を指す* の区別と、 `dig` の出力を実機の IP と突き合わせる作業は、 答えを読むのではなく Route 53 を操作して体得する実運用 DNS スキル。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 正本 (カタログ + 採点 + ヒント)
- [`template.yaml`](./template.yaml) — ペライチ CFn テンプレート (デプロイ本体)
