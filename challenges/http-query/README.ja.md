# QUERY: 誰も知らないメソッド

> English: [README.md](./README.md)

**RFC 10008 — HTTP `QUERY` メソッド** (Standards Track, 2026年6月) を題材にした Challenge。 `QUERY` は **safe かつ idempotent** で、 クエリを URI ではなく **request body** に載せる、 生まれたばかりのメソッド。 仕様どおりに完璧に実装された検索バックエンドが、 それでも本番では死んでいる ── 経路の途中 (エッジ) が、 まだこの新しいメソッドを知らないからだ。 リクエストがどこで死んでいるかを切り分け、 エッジを直す。

| 項目      | 値                                                       |
| --------- | ------------------------------------------------------- |
| カテゴリ  | Challenge (セルフペース)                                |
| 難易度    | 3 / 5 (中級)                                            |
| 想定時間  | 30〜45 分                                                |
| status    | `ready`                                                 |
| スコア    | `flag` (`points`: 300, `wrongAnswerPenalty`: 15)        |

## ストーリー

前任の SRE が、 検索 API をピカピカの新メソッド HTTP `QUERY` (RFC 10008) に移したまま、 先週退職した。

そして顧客から悲鳴が届く。 *「検索が死んでる。 405 が返る」*。 ところがアプリのコードを開くと、 `QUERY /search` は仕様どおり完璧に実装されている。 ローカルでは動く。 なのに **本番の公開 URL** を叩くと `405` が返る。

CTO 曰く *「コードは正しいんだろ。 なら、 何が殺してる?」*

あなたのミッション: 仕様どおりの API を `405` で殺している犯人を特定し、 `QUERY /search` が本番経由で通る状態に戻し、 仕様準拠のリクエストで検索を生き返らせる ── そして flag を手に入れる。

## デプロイされるもの

```
                        +----------------------------------------------+
                        |  Application Load Balancer (internet-facing)  |
   curl -X QUERY  --->  |  Listener :80                                 |
                        |   |- Rule p10  http-request-method in         |
                        |   |     { GET, HEAD, POST, OPTIONS }  --+      |
                        |   |     (QUERY が欠けている -- これがバグ) |    |
                        |   \- default action: fixed-response 405 |      |
                        +-----------------------------------------+------+
                                       QUERY はここに落ちる <-----+ | マッチしたメソッド
                                       (エッジで 405)               v
                                              +-----------------------------------+
                                              |  Lambda 検索 API (バックエンド)    |
                                              |  RFC 10008 の QUERY /search を     |
                                              |  正しく実装。 アプリは正常。       |
                                              +-----------------------------------+
```

- **VPC + public subnet 2 つ** (ALB は 2 AZ 必要)、 IGW、 route table、 ALB 用 security group (tcp/80 を internet から許可)。
- **Lambda** ── RFC 10008 の検索 API を **ALB Lambda target** として正しく実装。 ELB レスポンス形状を返し、 *到達した + 仕様準拠の* `QUERY` のときだけ flag を返す。
- **internet-facing な ALB** ── HTTP:80 listener の **default action が固定 `405`**、 そして `GET / HEAD / POST / OPTIONS` だけをバックエンドに forward する listener rule が 1 つ。 **`QUERY` はそのルールから意図的に欠けている** ので、 `QUERY` はどのルールにもマッチせず default action に落ち、 *エッジで* `405` を食らう。 アプリには届かない。
- **`ParticipantViewerRole`** ── read-only baseline + 切り分け・修正に必要な最小限:
  - `elasticloadbalancing:Describe*` (LB / listener / rules を読む)、
  - `elasticloadbalancing:ModifyRule` を **自分のルールの ARN にだけ** scope、
  - `logs:FilterLogEvents` / `GetLogEvents` を自分の Lambda のロググループに (アプリが正常で `QUERY` が一切届いていないことを確認)、
  - `ec2:Describe*` を自分の stack に tag-scope。
  - **`cloudformation:DescribeStacks` は無し** ── だから `AnswerFlag` Output は自分からは見えない。 flag は、 本物の仕様準拠 `QUERY` でアプリに到達することでしか手に入らない。

## 解き方

**1. 現象を見る。** Participant Portal の `SearchEndpoint` Output を取り、 叩く:

```bash
curl -i -X QUERY "$SEARCH_ENDPOINT" \
  -H 'content-type: application/json' \
  --data '{"query":{"match":"hello"}}'
# -> HTTP/1.1 405  (エッジから: "the edge method allow-list does not include this HTTP method")
```

**2. アプリの無実を証明する。** 同じ URL への素の `GET` は `200` (ヒントページ) を返すのでバックエンドは生きている。 さらに Lambda の CloudWatch Logs には **QUERY の呼び出しが一切無い** ── リクエストは関数に届く *前に* 死んでいる:

```bash
aws logs filter-log-events --log-group-name "/aws/lambda/<NamePrefix>..." --limit 20
```

405 を生んでいるのは **エッジ (ALB listener rule)** であって、 アプリではない。

**3. ルールを見つける。** listener rule を一覧し、 メソッドの allow-list を読む:

```bash
aws elbv2 describe-rules --listener-arn <自分の listener ARN>
# -> http-request-method = [GET, HEAD, POST, OPTIONS] という条件のルールが 1 つ (QUERY が無い)
```

**4. エッジを直す (fix-by-settings)。** そのルールの `http-request-method` Values に `QUERY` を足す ── **既存** の CFn 所有ルールを *変更* するだけで、 新規リソースは作らない:

```bash
aws elbv2 modify-rule --rule-arn <自分の rule ARN> \
  --conditions 'Field=http-request-method,HttpRequestMethodConfig={Values=[GET,HEAD,POST,OPTIONS,QUERY]}'
```

(Console: **EC2 → ロードバランサー → 該当 LB → リスナー → ルール → 編集**。 `ListenerRulesConsoleUrl` Output が LB へ直リンクする。)

**5. flag を取る。** 手順 1 の `QUERY` をもう一度送る。 今度はバックエンドに到達し、 仕様準拠リクエストが通り、 レスポンス本文に flag が返る:

```bash
curl -s -X QUERY "$SEARCH_ENDPOINT" \
  -H 'content-type: application/json' \
  --data '{"query":{"match":"hello"}}'
# -> 200 ... Flag: TC{...}
```

`TC{…}` を Participant Portal に貼る。 正解 → +300 pt。 誤答 → -15 pt。

### 厳格な body 取り扱い (バックエンドの設計)

この API は **content sniffing を一切しない** ── RFC 10008 の厳格なリクエスト取り扱いを教える。 エッジが `QUERY` を許可した後、 以下はすべてアプリ側で区別される:

| リクエスト                                            | レスポンス |
| ----------------------------------------------------- | ---------- |
| `Content-Type` なし                                   | `415`      |
| `application/json` 以外の `Content-Type`              | `415`      |
| body が妥当な JSON でない                             | `400`      |
| JSON は妥当だが DSL が `{"query":{"match":"<text>"}}` でない | `422` |
| 妥当な `Content-Type` + 妥当な JSON + 妥当な DSL       | `200` + flag |
| `OPTIONS` (CORS preflight)                            | `204` + `Access-Control-Allow-Methods: …, QUERY, …` |
| `GET`                                                 | `200` ヒントページ (flag 無し) |
| `POST`                                                | `200`「動くが POST は safe でも idempotent でもない。 正しくは QUERY」(flag 無し) |

## ヒント (使うとスコアが下がる)

| hint   | 内容                                                                                                  | ペナルティ |
| ------ | ---------------------------------------------------------------------------------------------------- | ---------- |
| hint-1 | アプリは正常: `GET` は 200 を返し、 Lambda ログには QUERY が一切届いていない。 アプリではなく **エッジ** (ALB) を疑え。 | -15  |
| hint-2 | ALB listener rule には HTTP メソッドの allow-list (`http-request-method`) がある。 今のルールは GET/HEAD/POST/OPTIONS だけ許可していて、 **QUERY が入っていない** ので default の 405 に落ちる。 | -25 |
| hint-3 | `aws elbv2 modify-rule … HttpRequestMethodConfig={Values=[GET,HEAD,POST,OPTIONS,QUERY]}` で QUERY を足し、 もう一度 QUERY を送る。 | -35 |

## スコア

| 状態                                                       | スコア |
| ---------------------------------------------------------- | ------ |
| 正解 (仕様準拠 QUERY が返した `TC{…}`)                      | +300   |
| 誤答                                                       | -15    |

## コスト

- **ALB は stack が存在する限り常時課金** (時間課金 + LCU)。 ALB に spot / burst 割引は無い。
- Lambda (リクエスト課金)、 VPC、 subnet、 IGW、 security group、 route table はこの規模では実質 **無料**。
- **解き終わったら `delete-stack`。** 修正は既存の CFn 所有ルールの変更だけ (参加者が作るトップレベルリソースは無い) なので、 stack を消せば orphan は残らない。

## 学習ゴール

- **本文の有無ではなく HTTP の意味論でメソッドを選ぶ**: 読み取りで再試行安全な検索は `QUERY`、 副作用のあるジョブ開始は `POST`。
- **新しい標準メソッドがエッジ / ミドルボックスで割れる理由。** ALB は custom HTTP method を forward *できる* ── `http-request-method` condition は custom メソッドを完全一致・大文字小文字区別 (ワイルドカード不可) でマッチする ── 許可リストに足せば通る。 だが **CloudFront は非標準メソッドに `501` を返す** (この問題がアプリを CloudFront ではなく ALB の背後に置く理由がまさにこれ)、 そしてブラウザの **`fetch({ method: 'QUERY' })` は CORS preflight を発火** させ、 サーバは `Access-Control-Allow-Methods: …, QUERY` で応答する必要がある。
- アプリだけでなく **経路の途中** (リバースプロキシ / WAF / API gateway / エッジ) を、 ログと HTTP trace で切り分ける。
- content sniffing に頼らない **厳格な `Content-Type` / body 取り扱い** (`400` / `415` / `422`)。

## RFC とレッスン

- RFC 10008 — *The HTTP QUERY Method*: <https://www.rfc-editor.org/rfc/rfc10008>
- この問題が劇化するテーゼ: **標準・ブラウザ・プロキシ・クラウドのエッジが、 新メソッドの追随速度をそれぞれ別々に持つ** ために、 仕様準拠の API が end-to-end では死ぬことがある。 新しい標準を読む力は半分。 現実の経路互換性を検証し運用に落とす力が、 もう半分。

## 関連ファイル

- [`metadata.json`](./metadata.json) ── 問題メタデータ (JA + `i18n.en`)
- [`template.yaml`](./template.yaml) ── 1 ページ CFn テンプレート (VPC + ALB + Lambda 検索 API + scope 済み IAM role)
- [`diagram.svg`](./diagram.svg) ── アーキテクチャ概観
