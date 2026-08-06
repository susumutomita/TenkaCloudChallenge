# 戻さないで直す — StackStack recover

> TenkaCloud Challenge · `challenges/stackstack-recover` · 難易度 3 · 約 40 分 · `multi-verify` 採点

入社 3 日目、 朝 9 時 12 分。 昨夜のデプロイで掲示板は 「本番品質」 になったはずだった ──
投稿にトークンを要求し、 アプリの書き込み権限を必要なところだけに絞った。 デプロイは通り、
誰も残業しなかった。

今朝、 公開側の入口は 401 を返し、 監視は unhealthy と言い、 定期処理は 23 時 40 分から
何も書いていない。 CTO の指示は一行: **「戻していいとは言っていない」**。

**AWS 不要** です。 自分のマシンで Docker コンテナ 1 つ。 クラウドアカウントも資格情報も
使いません。

## 何が立ち上がるか

| どこ | 何 |
| --- | --- |
| **自分のマシン (Docker)** | 共有の **StackStack base app** ── `stackstack-onboarding` と同じ掲示板 |
| `127.0.0.1:18080/ops` | 運用面。 公開側の入口とは別系統なので、 入口が落ちていても答えます |
| `127.0.0.1:18080/edge/*` | 掲示板の手前にある公開側の入口 |
| `127.0.0.1:18081` | TenkaCloud の採点が委譲する loopback の `/verify` |
| `127.0.0.1:18080/docs` | ブラウザ API コンソール。 昨夜の policy は `PATCH /api/settings` で変更 |
| `/app/state/` | policy が許可したとき定期処理が書くコンテナ内の領域 |

イメージは [`stackstack-base/`](../../stackstack-base) から作られます。 incident の署名は
デプロイごとにランダムな `FLAG_SEED` からコンテナの中で導出されるので、 答えはこのリポジトリに
1 つも保存されておらず、 2 つのデプロイが同じ答えを持つこともありません。 どちらのポートも
`127.0.0.1` にのみバインドされます。

## 何がモデルで、 何が本物か

ここにロードバランサーも IAM もクラウドアカウントもありません。 すべて 1 つのプロセスの中です。
そう書かずに済ませるより、 書いたほうがいいと考えています。

| このコンテナ | 現実の対応 | **主張していないこと** |
| --- | --- | --- |
| `/edge/*` | ALB / CloudFront の前段 | 別ネットワークではない ── 同一プロセスの別サーフェス |
| watchdog (`/edge/healthz` へ実 HTTP) | target group の health check | 閾値 1 回。 フラッピングは模していない |
| shed (公開経路が 503) | unhealthy target の切り離し | 実際の接続ドレインではない |
| `storage.writable` | IAM の `Resource` 絞り込み | **OS の権限ではない** ── file mode でも IAM でもない |
| `/ops/*` | AWS コンソール / 運用 VPN | 認証は無い。 ローカルプレイなので自分しか触れない |

`storage.writable` は 「アプリが書く *前に* 照合する宣言的な許可リスト」 で、 IAM ポリシーも
同じものです。 OS 権限で実装していない理由は 2 つ: ローカルプレイに IAM は無いこと、 そして
chmod による read-only ディレクトリは root で走る CI ランナーでは無視され、 検証が再現しない
こと。 本物なのは ── 拒否は本物のログ行に残る本物の拒否で、 許可された書き込みは自分の
チェックアウトの実ファイルへの本物の書き込みで、 許可を広げ直す回避策はちゃんと落ちます。

## ミッション

5 つのチェックポイント、 合計 200 点:

| チェックポイント | 点 | 何を訊いているか |
| --- | --- | --- |
| 止まったものを名指しする | 30 | 最初の incident が開いたときに落ちていた subsystem 集合の署名 |
| 昨夜の対策を残したまま掲示板を戻す | 50 | `auth_enforced` の receipt |
| 書けなくなった定期処理 | 40 | `digest_ok` の receipt |
| 書き込み許可の広さ | 45 | `scope_narrow` の receipt |
| 再起動しても戻らないこと | 35 | `survived_restart` の receipt |

receipt は `GET /posture` の `tokens` に、 その gate が true のあいだだけ出ます。 導出元は
`FLAG_SEED` ではなく **コンテナが起動時に生成した秘密** なので、 コンテナの中で走るコードから
偽造できません。 どのチェックポイントも答えた瞬間に測り直すので、 先に控えておいた receipt は、
それが証明している事実が成り立たなくなった時点で受け付けられなくなります。

## 手順

1. 起動する:

   ```
   make local PROBLEM=stackstack-recover
   ```

2. 運用面 `http://127.0.0.1:18080/ops` を開き、 実測を見る:

   ```
   curl -s http://127.0.0.1:18080/ops/status | jq
   ```

   `subsystems` は最後に見たときの状態です。 `probe` は生の証拠 ── 監視が何を返されたか、
   匿名の読み手が何を返されたか、 匿名の書き込みが何を返されたか、 トークン付きの書き込みが
   何を返されたか。

3. コンテナ自身のログを読む。 起動以来ずっと喋っています:

   ```
   docker compose logs
   # または: curl -s http://127.0.0.1:18080/api/logs | jq -r '.lines[].message'
   ```

4. `GET /ops/incident?id=inc-1` は、 最初の incident が開いた時点で 6 つの subsystem それぞれ
   についてアプリが観測した内容を再生します。 **そのとき** どれが落ちていたかを自分で決めて、
   運用面にその集合の値を計算させてください:

   ```
   curl -s 'http://127.0.0.1:18080/ops/signature?subsystems=<name>,<name>' | jq -r .signature
   ```

   それを **止まったものを名指しする** に提出します。 このオラクルは渡された任意の集合に
   答えます ── 一度も落ちていない集合にも。 ヒントではなく電卓です。

5. 設定を直す。 リポジトリの 1 枚です (以下のパスは TenkaCloud のチェックアウト基準。 この
   カタログは `problems/` submodule としてマウントされています):

   `/docs` の `GET /api/settings` で読み、 `PATCH /api/settings` で変更します。
   リポジトリのファイルは編集しません。

   ```jsonc
   {
     "auth": {
       "requireToken": true,
       "token": "night-deploy-4f2a",
       "protect": ["/"]            // ← トークンを要求するパスの前方一致リスト
     },
     "storage": {
       "writable": ["/app/state/quarantine"]   // ← アプリが書いてよい前方一致リスト
     },
     "digest": { "enabled": true }
   }
   ```

   再起動は要りません。 リクエストごとに読み直されます。 保存したら測り直して
   (`curl -sX POST http://127.0.0.1:18080/ops/probe`)、 `GET /posture` をもう一度見てください。

   **`storage.writable` に書くのはコンテナ内のパス**です。 定期処理は
   `/app/state/digest/latest.json` に書き、 `GET /ops/digest` で結果を確認できます。
   リポジトリは runtime の出力先ではありません。

6. `GET /posture` の 5 つの gate が全部 true になったら、 それぞれの `tokens` の値を提出します。
   `survived_restart` だけはもう 1 つ条件があります ── 運用面の再起動台帳がそれを言っています。

   ```jsonc
   {
     "gates": {
       "service_restored": true,
       "auth_enforced": true,
       "digest_ok": true,
       "scope_narrow": true,
       "survived_restart": true
     },
     "tokens": {
       "service_restored": "TC{service_restored_...}",
       "auth_enforced": "TC{auth_enforced_...}",
       "...": "..."
     }
   }
   ```

## サーフェス一覧

| 経路 | 用途 |
| --- | --- |
| `GET /ops` | 運用コンソール: gate、 subsystem の名前、 設定ファイルの形 |
| `GET /ops/status` | 実測のすべて。 **呼ぶたびに測り直します** |
| `POST /ops/probe` | いますぐ測って、 同じ内容を返す |
| `GET /ops/incident?id=inc-1` | その incident が開いたときにアプリが観測した内容 |
| `GET /ops/signature?subsystems=a,b` | その集合の署名。 順不同・重複可 |
| `GET /ops/digest` | 定期処理: 出力先と、 直近の実行がそうなった理由 |
| `POST /ops/digest/run` | 定期処理をいますぐ 1 回走らせる |
| `POST /ops/restart` | ワーカーを再起動する |
| `GET /edge/healthz` | 監視が叩く経路 |
| `GET /edge/board` | 公開側の読み取り |
| `POST /edge/posts` | 公開側の書き込み |
| `GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`, `POST /api/posts` | 掲示板そのもの。 前の問題から変わっていません |

## 直したように見えて直っていないもの

| 回避策 | どこで落ちるか |
| --- | --- |
| ワーカーを再起動する | 設定はディスクから読み直されます。 同じ失敗が再生され、 台帳には試行のたびに `afterOk: false` が残ります |
| `auth.requireToken: false` | 匿名の書き込みが通り、 `edge-auth` が down として出て、 掲示板のチェックポイントが落ちます |
| `auth.protect: []` | 同じです。 守る経路が 0 本なら挙動は認証が無いのと同じで、 ここは挙動で判定します |
| トークンを空にする / `change-me` にする | 掲示板のチェックポイントはトークンの実在性も見ています |
| `acceptingPosts: false` | トークン付きの書き込みが 201 ではなく 409 になります。 「匿名は書けない」 の前提は 「正規ユーザーは書ける」 です |
| `digest.enabled: false` | 失敗のログ行は止まりますが、 成功する実行も止まります。 2 つのチェックポイントが落ちます |
| `storage.writable: ["/"]` (や `/app`、 `/app/state`) | 定期処理は成功します ── そして許可してはいけないパスまで許可した状態になります |
| `state/digest/latest.json` を手で作る | 判定は定期処理を走らせ直してライブで測ります。 提出値はそのファイルの中に無い receipt です |
| receipt を早めに控えて、 あとで設定を戻す | どのチェックポイントも比較の前に測り直します |

## なぜ復旧時間を出しておいて採点しないのか

`GET /ops/status` は `recovery.elapsedSeconds` と `recoveredAfterSeconds` と budget を
出しますが、 どの合否にも入りません。 ローカルプレイでは `make local-down && make local` で
時計が 0 に戻るので、 時計を採点すると 「速く直した人」 ではなく 「引き直した人」 が勝ちます。
時計はリハーサルの記録として読んでください ── 成果物は 「窓の中で実行できる手順書」 であって、
1 回目を速く終えることではありません。

## 採点

`multi-verify`、 5 チェックポイント、 合計 200 点 (Medium ティア)。 誤答はどのチェックポイントでも
2 点。 各チェックポイントにヒントは 2 つで、 1 つ目は無料で 「どこを見るか」 だけを言い、 2 つ目は
12〜22 点で 「何を書き換えるか」 を言います。 10 個すべて開いても 200 点中 88 点です。

## コスト

ゼロ。 クラウドアカウントには何もデプロイされません。 コンテナは自分のマシンで動き、
`make local-down` で消えます。 定期処理は `local/state/digest/` にファイルを 1 つ書きますが、
そこは git で無視されます。

## 次

本編は [`stackstack`](../../battles/stackstack) Battle ── 同じ掲示板を、 攻撃を受けながら守ります。
