# インターネット進化史 Ep05 — 間違ったエッジ

> English: [README.md](./README.md)
> **インターネット進化史** シリーズ最終話。 各話は「インターネットがどう進化したか」の 1 場面を、 ネットワークの層を *暗記する* のではなく *自分で操作する* ことで追体験する。 Ep05 は **edge / anycast / CDN 時代** ── 「どこから配信するか」を選ぶ層がテーマ。

天下クラウド株式会社。 前任の SRE が去り、 君は新人のまま最後の砦を任された。

> CTO 曰く: 「ユーザーに配信されてる中身が古い。 先月のキャッシュだ。 サイト自体は生きてる、 サーバーも全部動いてる。 なのに edge を通すと、 誰のところにも『去年のゴミ』が届く。 前任の SRE が最後に触ったのが配信の交通整理だった ── それ以来だ」

インターネットは『近くの edge から配る』時代に進化した。 CDN / anycast / QUIC ── どこから配信するかを選ぶ層が増えた。 君の仕事は、 `edge` がなぜ『間違った origin』を選び続けているのかを突き止め、 交通整理をやり直して、 本物の origin が握るフラグを取り出すことだ。

## これはクイズではない

フラグは暗記して打ち込む概念名ではない。 deploy ごとにランダム生成され、 **`origin-good` だけが知っている値**で、 private ホストが HTTP で配っている。 `edge` は間違った origin に向いているので、 交通整理を実際に直すまで読めない。 答えを「思い出す」のではなく、 AWS を「操作して」手に入れる。

## デプロイされるもの

CloudFormation 1 スタック (全リソース CFn 管理下 → `delete-stack` で完全消去):

```text
                          VPC 10.50.0.0/16
┌──────────────────────────────┬──────────────────────────────┐
│  public サブネット 10.50.1.0/24 │  private サブネット 10.50.2.0/24│
│  ┌──────────┐   ┌──────────┐  │   ┌────────────┐              │
│  │  relay   │   │   edge   │  │   │ origin-good│  TC{...}      │
│  │ (踏み台) │   │  :80     │──┼──►│  :8080     │  (本物)      │
│  └────┬─────┘   │リバプロキシ│  │   └────────────┘              │
│   SSM │  curl ─►└────┬─────┘  │   ┌────────────┐              │
│       │             │ 上流を │   │origin-stale│  ゴミ        │
│       ▼          選ぶ ───────┼──►│  :8080     │  (先月分)    │
│  あなたが edge を SSM で操作   │   └────────────┘              │
│  /<prefix>/config/active_origin = "stale"  ◄── 仕込んだ罠     │
└──────────────────────────────┴──────────────────────────────┘
```

- `relay` — t3.micro, public サブネット, **SSM Session Manager** で接続 (SSH 鍵不要・inbound ポート不要)。
- `edge` — t3.micro, public サブネット, `:80` の小さな **リバースプロキシ**。 SSM パラメータ `/<NamePrefix>/config/active_origin` を 15 秒ごとに読み直し、 選ばれた origin に転送する。 プロキシ自体は正しい ── 交通整理の設定が指す origin を忠実に配るだけ。
- `origin-good` — t3.micro, private サブネット, **public IP なし**, `:8080` で per-deploy のフラグを配る (`X-Origin: good`)。
- `origin-stale` — t3.micro, private サブネット, **public IP なし**, `:8080` で stale なゴミ banner を配る (`X-Origin: stale`)。
- Security Group × 3 (すべて正常)。 ネットワークは完全に健全 ── **仕込んだ罠は steering パラメータ** で、 値が `stale` に固定されている。

CloudFront / NAT Gateway / EIP / ALB なし。 1 時間で **約 $0.10**。

## 遊び方

1. **`relay` に入る** (Session Manager):
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay の instance id>
   ```
2. **症状を見る ── `edge` を叩く:**
   ```bash
   curl -v http://<edge の private ip>:80
   ```
   `X-Origin: stale` のゴミ banner が返る。 レスポンスヘッダ `X-Edge-Upstream` で、 edge がどの origin IP に転送しているかが分かる。
3. **2 つの origin をそれぞれ直接叩いて** どちらが本物かを見極める:
   ```bash
   curl http://<origin-good の private ip>:8080    # X-Origin: good  + フラグ TC{...}
   curl http://<origin-stale の private ip>:8080   # X-Origin: stale + ゴミ
   ```
   ネットワークは健全で、 両 origin とも応答する。 問題は『経路』ではなく『edge がどちらを指しているか』。
4. **交通整理の設定を読む** (動かぬ証拠):
   ```bash
   aws ssm get-parameter --name /<NamePrefix>/config/active_origin --query Parameter.Value --output text
   # -> stale
   ```
5. **設定を 1 つ書き換える** (新規リソースではなく、 既存パラメータの値変更 = 設定変更):
   ```bash
   aws ssm put-parameter --name /<NamePrefix>/config/active_origin --value good --overwrite
   ```
   約 15 秒で edge の refresh ループが上流を `origin-good` に切り替える。
6. **もう一度 `edge` を叩く** ── 今度は `X-Origin: good` とフラグ `TC{...}` が返る。 Portal に submit。

## 採点

- 正解: **+300 pt** (1 デプロイにつき 1 回)。
- 不正解: **−15 pt** /回 (0 未満にはならない)。
- 段階ヒントは点数ペナルティ付き (`metadata.json` 参照)。

## コスト

t3.micro × 4 台で約 1 時間 ≈ **$0.10**。 CloudFront / NAT / EIP / ALB なし。 `aws cloudformation delete-stack` で撤収 ── 全部 CloudFormation が作ったので、 孤児リソースは 1 つも残らない。

## 設計メモ (作問者向け)

最終話も Ep01 と同じ 3 原則を edge 層に適用する:

1. **発見型フラグ** ── フラグは `origin-good` だけが持ち、 edge を正しく向け直して初めて到達できる。 暗記では解けない。
2. **設定変更で直す・手で新規作成しない** ── テンプレは edge を間違った origin に向けた状態でデプロイし、 解法は既存 SSM パラメータの *変更* (`active_origin: stale → good`)。 参加者はトップレベルリソースを作らないので `delete-stack` で完全クリーンアップ (CFn 管理外の孤児ゴミが残らない)。 CloudFront / NAT / EIP を使わないことでコストと孤児リスクの両方を回避。
3. **本物の「気づき」** ── 「ネットワークは完全に健全なのに *origin 選択* が間違っている」は実運用の CDN スキル (origin 切り戻し / stale コンテンツの切り分け)。 各 origin を curl して `X-Origin` ヘッダを見比べて体得する ── 答えを読むのではない。

Ep02 (DNS) とは意図的に被らせない: Route 53 も DNS 解決パズルも無い。 steering は config パラメータで駆動する明示的なリバースプロキシの上流選択 ── edge / anycast 時代の対応物。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 正本 (カタログ + 採点 + ヒント)
- [`template.yaml`](./template.yaml) — ペライチ CFn テンプレート (デプロイ本体)
