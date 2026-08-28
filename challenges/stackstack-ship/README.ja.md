# 外から見えるところまで — StackStack ship

> TenkaCloud Challenge · `challenges/stackstack-ship` · 難易度 3 · 約 45 分 · `multi-verify` 採点

板は動いています。 運用コンソールの内側だけで。 これは、 それが 「自分のノート PC の中のもの」 から
「入口があるもの」 に変わる回です。

**AWS 不要** です。 自分のマシンの Docker コンテナ 1 本だけ、 クラウドアカウントも認証情報も
使いません。 模しているのはリリース基盤 ── artifact registry、 manifest、 health gate 付きの
staged pipeline、 live release ポインタ、 そして実際に何かがデプロイされているときだけ応答する
公開サーフェス。

## 何が立ち上がるか

| どこ | 何 |
| --- | --- |
| **自分のマシン (Docker)** | 共有の **StackStack ベースアプリ** を `SCENARIO=ship` で起動したもの |
| `127.0.0.1:18080/shipyard` | 運用コンソール ── registry、 releases、 デプロイログ、 secret store |
| `127.0.0.1:18080/site` | 公開側の入口 ── 外が受け取るもの |
| `127.0.0.1:18081` | TenkaCloud の採点が委譲する loopback の `/verify` |
| `127.0.0.1:18080/docs` | ブラウザ API コンソール。 manifest は `PATCH /api/settings` で変更 |

image は StackStack 系問題が共有する [`runtimes/stackstack/`](../../runtimes/stackstack) から
ビルドされます。 artifact の id、 public serial、 デプロイの receipt、 署名鍵の store は
すべてコンテナ内でデプロイごとのランダムな `FLAG_SEED` から導出されるので、 答えはこの
リポジトリに 1 つも置かれておらず、 2 つのデプロイが同じ答えを持つこともありません。
ポートはどちらも `127.0.0.1` にだけバインドされます。

### 模型であることについて正直に

ここに公開 URL はありません。 別ネットワークもありません。 `/site` は **同じ origin の
別サーフェス** で、 同じプロセスが返しています。 模しているのは狭く、 そして模す価値のある
1 点だけ ── *運用コンソールに見えていることと、 公開側の入口が実際に返すことは別の事実だ*
という点です。 障害ドメインの分離も TLS も CDN も模していないし、 主張もしません。

AWS に移したときの対応:

| Shipyard | 現実の対応 |
| --- | --- |
| artifact registry | ECR / コンテナレジストリ |
| release + generation | App Runner / ECS のリビジョン |
| `BOARD_SIGNING_KEY: "<値>"` | 環境変数に秘密を貼り付ける |
| `BOARD_SIGNING_KEY: {"fromSecret": "..."}` | Secrets Manager 参照 |
| `/site` | ALB / CloudFront の向こう側 |
| `GET /posture` の gate | 昇格の前に置くデプロイゲート |

## ミッション

チェックポイント 5 つ、 合計 200 点:

| チェックポイント | 点 | 何を訊いているか |
| --- | --- | --- |
| 配るものを突き止める | 20 | この基盤が手元に持っている artifact の id |
| リリースを 1 本通す | 40 | リリースが live になったときに書かれるログ行の receipt |
| 公開側の見出しを差し替える | 40 | 公開側の入口が実際に返している見出し |
| 鍵の入れ替えをまたぐ | 60 | 次の入れ替えを見ている gate の receipt |
| 止めずに片付ける | 40 | `GET /posture` の切り替え合格印 |

## 手順

1. 起動する:

   ```
   make local PROBLEM=stackstack-ship
   ```

2. `http://127.0.0.1:18080/shipyard` を開く。 registry に artifact が 1 つあり、
   それを配っているリリースは 1 つもありません。 公開側の入口に訊いてみます:

   ```
   curl -s http://127.0.0.1:18080/site/healthz | jq
   ```

   ```json
   { "error": "no_live_release", "detail": "nothing is deployed at the moment" }
   ```

   ビルドはもう終わっています。 デプロイはまだ 1 度も始まっていません。 これは 2 つの
   事実であって、 1 つではありません。

3. 前任者が残していったものをそのままデプロイしてみる:

   ```
   curl -sX POST http://127.0.0.1:18080/shipyard/releases | jq '.release.failure'
   ```

   止まります。 そして止まった stage を名指しします。 その内容を

   `/docs` の `GET /api/settings` で読み、 `PATCH /api/settings` で変更します。
   リポジトリは読み取り専用のままです。

   で直して、 もう一度打ってください。 リリースが promote されるまで繰り返します。
   再起動は要りません ── manifest はデプロイのたびに読み直されます。 stage は
   `read-manifest` / `resolve-artifact` / `resolve-config` / `start` / `health-gate` /
   `promote` の順に走り、 拒否されたデプロイは `5xx` ではなく `422` を返します。
   デプロイが拒否されるのは異常ではなく通常の結果です。

4. リリースが live になると、 2 つめのチェックポイントが求めている行がログに出ます:

   ```
   curl -s http://127.0.0.1:18080/api/logs?limit=200 | jq -r '.lines[].message' | grep promote
   ```

5. 外がいま何を返しているかを見て、 見出しを自分のものにする:

   ```
   curl -s http://127.0.0.1:18080/site/healthz | jq
   ```

   この見出しは `config/app.json` ではなくリリースから来ています。 manifest 側で変えて、
   デプロイし直して、 `/site` が何を返すか確かめてください。

6. 本番の鍵は入れ替わります。 自分で入れ替えて、 何が起きるか見てください:

   ```
   curl -sX POST http://127.0.0.1:18080/shipyard/secrets/rotate | jq
   curl -s     http://127.0.0.1:18080/site/healthz | jq
   ```

   それを生き延びられるかどうかは、 リリースが署名鍵をどう解決したかで決まり、
   それを決めているのは manifest です。

7. posture を見て片付ける:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "site_serving": true,
       "survives_key_rotation": true,
       "single_release": true
     },
     "tokens": { "survives_key_rotation": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   false の gate がそのまま次にやることです。 `GET /shipyard/releases` は、 あなたが
   来たときすでにあったものも含めて全部の記録を並べ、
   `DELETE 'http://127.0.0.1:18080/shipyard/release?id=rel-N'` で 1 件消せます。

8. チェックアウトを戻すのは合格印を提出した **あと** にしてください。 manifest を戻して
   デプロイし直すのは構いませんが、 戻したまま plane を空にすると gate が赤に戻ります:

   sign-off 提出後にやり直すなら `DELETE /api/settings` またはコンテナ再作成です。

## この問題が足すサーフェス

| ルート | 用途 |
| --- | --- |
| `GET /shipyard` | 運用コンソール (ページ) |
| `GET /shipyard/artifacts` | ビルド済みのもの |
| `GET /shipyard/releases` | 全リリース記録と、 その状態・鍵の解決方法 |
| `GET /shipyard/release?id=rel-1` | 1 件と、 stage ごとの経過 |
| `POST /shipyard/releases` | いまディスク上にある manifest でデプロイする |
| `DELETE /shipyard/release?id=rel-1` | 記録を消す (live のものも消せます) |
| `GET /shipyard/secrets` | store にある名前と version |
| `GET /shipyard/secrets/value?name=…` | secret の中身を読む (読んだことはログに残ります) |
| `POST /shipyard/secrets/rotate` | secret を次の version に入れ替える |
| `GET /shipyard/state` | live release、 generation、 secret version、 公開側の判定 |
| `GET /site` | 公開側の入口 (ページ) |
| `GET /site/healthz` | 公開側のヘルスチェック。 serial と署名を含む |

板自身のルート (`GET /`、 `/api/board`、 `/api/logs`、 `/posture`、 `/healthz`、
`POST /api/posts`) は stackstack-onboarding のままです。

## なぜこう作られているか

面白い近道はどれも、 ちゃんと動きます ── 動かなくなるまでは。 そこが本題です。

- **署名鍵の値を読んで manifest に直書きする。** できます。 store は値を渡しますし、
  渡したことをログに残します (本物と同じです)。 デプロイは通り、 health gate も通り、
  `/site` は 200 を返すので、 *公開側の見出しを差し替える* はこの経路でも本当に取れます。
  そのあと鍵が入れ替わると、 リリースが公開する署名がプラットフォームのいまの鍵で
  検証できなくなり、 入口は 503 を返します。 *鍵の入れ替えをまたぐ* (60) と
  *止めずに片付ける* (40) が落ちます。 この近道は問題の半分を失います。
- **先に入れ替えてから、 新しい値を貼る。** 入れ替えの判定は dry-run のプローブ世代
  ── store が次の入れ替えで取る値 ── に対して行われるので、 どれだけ新しく写しても
  必ず 1 世代遅れています。 採点は store を動かさないので、 狙えるタイミングもありません。
- **全部消して 「リリースは 1 本」 を満たす。** 0 は 1 ではありませんし、 plane が空なら
  `/site` は 503 です。 合格印を読むチェックポイントはどれも `/site` に実際の HTTP
  リクエストを投げて 200 を要求するので、 サービスを止めて片付いた体裁を作る経路は
  両方で落ちます。 復旧はデプロイし直すだけです。
- **他が全部緑だから、 失敗した試行は残しておく。** 記録が 2 件以上ある間、 合格印は
  出ません。 そして開始時点ですでに 1 件あるので、 消すものは必ず存在します。 残る 1 件は
  live であることも要求されるので、 「死んだ記録だけ残して他を消す」 も近道になりません。
- **`config/app.json` の見出しを書き換える。** 公開側の見出しは live release の環境
  変数からしか来ません。 板の設定は板のタイトルを決めるもので、 設定を外まで運ぶのは
  デプロイです。
- **manifest 側から health gate を緩める。** 緩められる health のフィールドが manifest に
  ありません。 gate はプラットフォームのもので、 `resolve-config` は知らないキーを
  無視せず拒否します。
- **答えを埋め込む。** artifact の id、 public serial、 receipt、 署名鍵の store は
  すべてコンテナ内でデプロイごとの `FLAG_SEED` から導出され、 gate の receipt は起動時に
  生成される秘密から導出されます ── 同じコンテナを再起動しただけでも変わります。

### 採点があなたにしないこと

*鍵の入れ替えをまたぐ* は何も入れ替えません。 入口をプローブし、 live release が
次の入れ替えのあとでも受理されるかを plane に訊き、 receipt を照合するだけです。
誤答で環境が壊れることはなく、 再送で 2 回入れ替わることもありません。 鍵が動くのは、
あなたが入れ替えたときだけです。

### 正直さの限界

判定はあなたが動かしているコンテナの中で計算されます。 自分のチェックアウトの
`runtimes/stackstack/` を書き換えて image を焼き直せば、 ここのチェックはすべて無効化できます。
このカタログのコンテナ問題すべてに共通することで、 `make local` は pin された `problems/`
submodule からビルドします。

## 採点

`multi-verify`、 チェックポイント 5 つ、 合計 200 点 (Medium ティア)。 誤答は各
チェックポイント 2 点 (合計 10)。 ヒントは各 2 つで、 1 つめは無料、 2 つめは
8 / 16 / 16 / 28 / 16。 全部開いても 84 点で、 116 点は残ります。

## コスト

ゼロ。 クラウドアカウントには何もデプロイされません。 コンテナは自分のマシンで動き、
`make local-down` で消えます。 リリース plane はコンテナのメモリ上だけに存在するので、
runtime の manifest override も一緒に消え、 リポジトリのチェックアウトは汚れません。

## Battle に何が引き継がれるか

正直に、 正しい粒度で書きます。 [`stackstack`](../../battles/stackstack) Battle は
`phased-polling` で採点される CloudFormation の問題なので、 JavaScript のモジュールも
プロセス内のリスナも境界を越えません。 引き継がれるのは形のほうです。

- **採点する事実** ── 「外から観測された 200」。 デプロイ記録が成功と言っていることではなく、
  ALB のターゲットグループが healthy と言っていることとして表現し直されます。
- **入れ替え判定** ── 「次の入れ替えを生き延びるか」。 環境変数に値を貼った task definition か、
  Secrets Manager の ARN を参照した task definition かの違いとして表現し直され、
  `DescribeTaskDefinition` が何も壊さずに答えられます。
- **gate の形** ── 申告ではなく走っているシステムを実測する昇格ゲート。 `GET /posture` は
  その小さな模型です。

## 次

この前は [`stackstack-onboarding`](../stackstack-onboarding) ── 同じ板での 15 分の
環境チェック。 このあとの本編は [`stackstack`](../../battles/stackstack) Battle です。
