# インターネット進化史 Ep04 — 握手が終わらない

> English: [README.md](./README.md)
> **インターネット進化史** シリーズの 1 話。 各話は「インターネットがどう進化したか」の 1 場面を、 TCP/IP の層を *暗記する* のではなく *自分で操作する* ことで追体験する。

天下クラウド株式会社、 ネットワーク班 4 日目。 加藤さんが置いていった社内 HTTPS エンドポイントに、 誰も繋げなくなった。

> 佐々木 CTO 曰く: 「踏み台 (`relay`) からアプリ (`app`) の :443 に `curl` すると、 TLS の握手 (handshake) でコケる。 証明書が合わないとか何とか。 加藤は『証明書は自動で作る仕組みにした』って言ってた。 仕組みは動いてる。 なのに弾かれる」

インターネットが **SSL から TLS 1.3 へ進化した瞬間** ── それは握手が「通信を暗号化する」だけでなく「相手が *本当に名乗った相手か*」を確かめる仕組みを磨いた瞬間だった。 君の仕事はその握手を成立させること。 なぜ証明書の名前が食い違うのかを突き止め、 設定を 1 つ直して `app` が握るフラグを取り出せ。

## これはクイズではない

フラグは暗記して打ち込む概念名ではない。 deploy ごとにランダム生成され、 **`app` だけが知っている値**で、 HTTPS で配られ、 *証明書の名前が一致した TLS 握手が成立して初めて* 読める。 答えを「思い出す」のではなく、 AWS を「操作して」手に入れる。

## デプロイされるもの

CloudFormation 1 スタック (全リソース CFn 管理下 → `delete-stack` で完全消去):

```text
                       VPC 10.40.0.0/16  (public サブネット 10.40.1.0/24)
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                   ┌────────────────────┐ │
│  │  relay   │  SSM ◄── あなた                    │        app         │ │
│  │ (踏み台  │                                    │  HTTPS :443 /flag  │ │
│  │ TLS clnt)│ ── TLS https://core.tenka.internal│  証明書 SAN ◄─ SSM │ │
│  └──────────┘ ──────────► :443 ─────► 握手が     │  tls_server_name   │ │
│      固定の名前を検証                    失敗:    └────────────────────┘ │
│      core.tenka.internal           SAN ≠ 期待する名前 (SSM の値が誤り)    │
└──────────────────────────────────────────────────────────────────────┘
```

- `relay` — t3.micro, public サブネット, **SSM Session Manager** で接続 (SSH 鍵不要・inbound ポート不要)。 TLS クライアントで、 常に固定のホスト名 `core.tenka.internal` を検証する。
- `app` — t3.micro, **HTTPS :443**, `/flag` で per-deploy のフラグを配る。 SSM の `/${NamePrefix}/config/tls_server_name` を起動時と 30 秒ごとに読み、 その名前を SAN にした **自己署名のリーフ証明書を作り直す** (署名はスタック自前の CA)。 平文のブートストラップポート (`:8080`) が `/ca.pem` で CA を配るので、 クライアントはリーフを検証できる ── このポートは **フラグを配らない**。
- Security Group × 2 (正常), SSM 設定パラメータ × 2: `tls_server_name` (**仕込んだ罠** ── 間違った名前) と `tls_min_version` (おとり, 既に正しい `TLSv1.3`)。

NAT Gateway / EIP / **ACM 証明書なし**。 45 分で **約 $0.02**。

## 遊び方

1. **`relay` に入る** (Session Manager):
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay の instance id>
   ```
2. **`relay` の中から `app` への TLS 握手を試みる:**
   ```bash
   /opt/relay/check_tls.sh <app の private ip>
   ```
   `curl: (60) SSL: no alternative certificate subject name matches target host name 'core.tenka.internal'` のように **失敗する**。 これが問題の核心。 通信路の暗号化はできているのに、 証明書の *名前* が違う。
3. **なぜ名前が食い違うのか** を SSM の設定から追う:
   - `relay` が検証するのは固定の `core.tenka.internal` (CFn Output `ExpectedTlsServerName`, MOTD にも表示)。
   - `app` が証明書に焼く名前は SSM から来る:
     ```bash
     aws ssm get-parameter --name /<NamePrefix>/config/tls_server_name --query Parameter.Value --output text
     # -> legacy.kato.example   (加藤さんの置き土産 ── 間違った名前)
     ```
   - `tls_min_version` は既に `TLSv1.3` で正しい。 **おとり**。 いじらない。
4. **SSM パラメータの値を 1 つ直す** (新規リソースではなく、 既存パラメータの設定変更):
   ```bash
   aws ssm put-parameter --name /<NamePrefix>/config/tls_server_name \
     --value core.tenka.internal --type String --overwrite
   ```
5. **~30 秒待つ** ── `app` のリフレッシュループが新しい SAN で証明書を作り直す。
6. **もう一度握手** ── 今度はフラグ `TC{...}` が返る:
   ```bash
   /opt/relay/check_tls.sh <app の private ip>
   ```
   Portal に submit。

タスク説明は SSM Parameter `/<NamePrefix>/briefing` にもある。

## 採点

- 正解: **+300 pt** (1 デプロイにつき 1 回)。
- 不正解: **−15 pt** /回 (0 未満にはならない)。
- 段階ヒントは点数ペナルティ付き (`metadata.json` 参照)。

## コスト

t3.micro × 2 台で約 45 分 ≈ **$0.02**。 NAT / EIP / ACM なし。 `aws cloudformation delete-stack` で撤収 ── 全部 CloudFormation が作ったので、 孤児リソースは 1 つも残らない。

## 設計メモ (作問者向け)

この話はカタログの 3 原則を、 トランスポート層のセキュリティに適用したもの:

1. **発見型フラグ** ── フラグは deploy ごとのランダム値で、 HTTPS で配られ、 証明書名が一致した TLS 握手が成立して初めて到達できる。 暗記では解けない。
2. **設定変更で直す・手で新規作成しない** ── テンプレは SSM の値を 1 つ間違えた状態でリソースを作り、 解法は既存パラメータの *変更* (`ssm:PutParameter`)。 設定駆動の `app` が 30 秒ループで証明書を作り直すので、 コードを触らず・リソースを作らずに修復が効く。 `delete-stack` で完全クリーンアップ (CFn 管理外の孤児ゴミも ACM 証明書も残らない)。
3. **本物の「気づき」** ── 「通信路は暗号化されているのに、 証明書の名前が要求したホストと違うから、 まともなクライアントは拒否する」は実運用の TLS スキル。 答えを読むのではなく、 握手が失敗する様子を見て体得する。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 正本 (カタログ + 採点 + ヒント)
- [`template.yaml`](./template.yaml) — ペライチ CFn テンプレート (デプロイ本体)
