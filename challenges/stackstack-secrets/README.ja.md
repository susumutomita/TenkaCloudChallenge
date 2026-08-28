# 板に載ってしまった鍵 — StackStack secrets

> TenkaCloud Challenge · `challenges/stackstack-secrets` · difficulty 3 · 約 40 分 · `multi-verify` 採点

板は社内に公開済み、 夜間ダイジェストは毎晩まわっていて、 板の 2 番目の投稿には運用キーが
そのまま載っています。 社内の誰でも読めます。 そして、 その投稿は下ろせません ── この板に
delete は無く、 これから生えることもありません。

その制約が、 この問題そのものです。 取り消せないものを前提にしたとき、 何を変えれば実害が
消えるのか。

**AWS は使いません**。 自分のマシンで Docker コンテナが 1 つ動くだけで、 クラウドアカウントも
資格情報も要りません。 模しているのは小さな運用基盤 ── status を持つ鍵ストア、 帯域外に置か
れた break-glass 資格情報、 allow-only のポリシーエンジン、 監査 journal、 そして止めては
いけない定期ジョブが 1 つ。

## 何がデプロイされるか

| どこに | 何が |
| --- | --- |
| **自分のマシン (Docker)** | 共有の **StackStack base app** を `SCENARIO=secrets` で起動 |
| `127.0.0.1:18080/` | 板そのもの (onboarding から変わりません) |
| `127.0.0.1:18080/api/ops` | 運用コンソール ── 鍵、 action カタログ、 ポリシー、 ダイジェスト |
| `127.0.0.1:18081` | TenkaCloud のスコアラーが委譲するループバックの `/verify` |
| `127.0.0.1:18080/docs` | ブラウザ API コンソール。 identity と grants は `PATCH /api/settings` で変更 |

イメージは StackStack 問題すべてが共有する [`runtimes/stackstack/`](../../runtimes/stackstack) から
ビルドされます。 漏れた鍵、 break-glass 値、 fingerprint、 witness、 revocation receipt、
policy digest はすべて、 デプロイごとにランダムな `FLAG_SEED` からコンテナ内で導出されます。
**このリポジトリには答えが 1 文字も入っていません**し、 2 つのデプロイが同じ答えを持つことも
ありません。 ポートはどちらも `127.0.0.1` にのみバインドされます。

### モデルについて正直に

ここに AWS アカウントはなく、 IAM も CloudTrail もありません。 動いているのは 1 プロセスの
数百行の JavaScript です。 対応と、 その限界:

| コンテナ内 | 現実の対応 |
| --- | --- |
| `ops-legacy` の secret が板の投稿に載っている | アクセスキーが Slack / Wiki / コミットに載っている |
| 鍵ストアの `status` と `revocationReceipt` | `aws iam update-access-key --status Inactive` / `delete-access-key` |
| break-glass 値 (起動時の出力にしか出ない) | root / break-glass 資格情報 (帯域外で保管される) |
| `grants: ["*"]` | `AdministratorAccess` |
| `grants: ["board:count","digest:publish"]` | 業務に必要な action だけの managed policy |
| `GET /api/ops/journal` | CloudTrail のデータイベント |
| 夜間ダイジェスト | 資格情報を握っている定期ジョブ |

**模しているのはライフサイクルと順序だけです。** IAM の評価規則は模していません ── この
ポリシー言語は allow-only の `service:action` とセグメント単位の `*` だけで、 そもそも拒否を
書く形が存在しません。 `Deny` も条件キーもリソース ARN もありません。 IAM のつもりで読むと
読みすぎになります。 持ち帰る価値があるのは 2 つ、 資格情報を入れ替える順序と、 ワイルドカード
が実際に何を抱えているかです。

## ミッション

チェックポイント 5 つ、 合計 200 点:

| チェックポイント | 点 | 何を聞かれるか |
| --- | --- | --- |
| 引き継ぎに残っていた運用キー | 40 | 板に載っている資格情報について運用 API が返すもの |
| 夜間ダイジェストがいま使っている鍵 | 40 | 夜間ジョブが認証に使った fingerprint |
| 古い鍵はもう何も開けない | 45 | 公開されてしまった資格情報を閉じた receipt |
| 運用キーにできること | 45 | ポリシーを見ている gate の receipt |
| 引き継ぎ完了の合格印 | 30 | `GET /posture` の合格印 |

## 手順

1. 起動する:

   ```
   make local PROBLEM=stackstack-secrets
   ```

2. 板を、 2 番目の投稿の最後まで読む:

   ```
   curl -s http://127.0.0.1:18080/api/board | jq -r '.posts[].body'
   ```

3. 運用コンソール `http://127.0.0.1:18080/api/ops` を開き、 いまの状態を聞く:

   ```
   curl -s http://127.0.0.1:18080/api/ops/state  | jq
   curl -s http://127.0.0.1:18080/api/ops/policy | jq
   curl -s http://127.0.0.1:18080/posture        | jq
   ```

   5 つの gate のうち 4 つが赤です。 緑の 1 つが、 壊してはいけないものです。

4. 板に載っているものが、 いまも通るかどうかを確かめる。 運用 API は資格情報の持ち主を教えて
   くれますが、 それを実際に提示できる人にだけです:

   ```
   curl -s -H 'X-Ops-Key: SSOPS-…' http://127.0.0.1:18080/api/ops/whoami | jq
   ```

5. 代わりの鍵を発行する。 これは運用キーではできないようにしてあります ── 自分の後継を発行
   できる資格情報は、 失効させても意味がないからです。 コンソールが名前を挙げているヘッダは、
   このコンテナの起動時の出力に 1 度だけ書かれ、 HTTP のどのサーフェスにも出ない値と照合され
   ます:

   ```
   docker compose logs | grep break-glass
   curl -sX POST -H 'X-Break-Glass: …' http://127.0.0.1:18080/api/ops/keys | jq
   ```

   secret が返るのはこの 1 回の応答だけで、 以後どこにも出ません。

6. 夜間ジョブを切り替える。 どの鍵で動くかを決めているのは

   `/docs` の `GET /api/settings` で読み、 `PATCH /api/settings` で変更します。
   credential も解答もリポジトリには書きません。

   です。 `identity` は鍵の**名前**であって鍵そのものではなく、 `SSOPS-` で始まる値は拒否され
   ます。 保存してからジョブを走らせてください:

   ```
   curl -sX POST http://127.0.0.1:18080/api/ops/digest/run | jq
   ```

   このコンテナに定期実行のタイマーは置いていません。 走らせるまで `/posture` は前の状態のまま
   です。 採点も、 判定の前に同じことをします。

7. 古い資格情報を閉じる:

   ```
   curl -sX POST -H 'X-Break-Glass: …' \
     'http://127.0.0.1:18080/api/ops/keys/revoke?keyId=ops-legacy' | jq
   ```

   `409 would_orphan_service` が返ったら、 夜間ジョブがまだその鍵に依存しています。 このガード
   レールは、 順序を間違えたときの代償を障害ではなくメッセージ 1 行にするためのものです。

8. 運用キーにできることを、 この板に要るぶんまで絞る。 `grants` は許可リストで、 拒否側に書く
   ものはありません。 何が要るかは、 走らせて拒否を読めば分かります:

   ```
   curl -sX POST http://127.0.0.1:18080/api/ops/digest/run | jq
   curl -s      http://127.0.0.1:18080/api/ops/journal     | jq '.entries[-4:]'
   ```

9. 実測を見て、 提出する:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "leak_confirmed": true,
       "key_rotated": true,
       "legacy_revoked": true,
       "least_privilege": true,
       "service_intact": true
     },
     "tokens": { "least_privilege": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

10. チェックアウトを戻すのは、 合格印を提出した**あと**にしてください。 先に `ops.json` を戻す
    と、 ジョブが失効済みの鍵を向いて gate が赤に戻ります:

    sign-off 提出後にやり直すなら `DELETE /api/settings` またはコンテナ再作成です。

## この問題が足すサーフェス

| ルート | 用途 |
| --- | --- |
| `GET /api/ops` | 運用コンソール (ページ) |
| `GET /api/ops/keys` | 鍵の棚卸し ── id、 fingerprint、 status。 secret は出ません |
| `POST /api/ops/keys` | 鍵を発行する (`X-Break-Glass`) |
| `POST /api/ops/keys/revoke?keyId=ops-legacy` | 鍵を閉じる (`X-Break-Glass`) |
| `GET /api/ops/whoami` | 提示された資格情報の持ち主 (`X-Ops-Key`) |
| `GET /api/ops/policy` | action カタログと、 いまの設定が実際に許していること |
| `POST /api/ops/act?action=…` | action を 1 つ実行する (`X-Ops-Key`) |
| `POST /api/ops/digest/run` | 夜間ダイジェストをいま走らせる |
| `GET /api/ops/journal` | 許可も拒否も残る監査ログ (鍵は fingerprint で識別) |
| `GET /api/ops/state` | identity、 ポリシー、 直近のダイジェスト実行、 journal の件数 |

板自身のルート (`GET /`、 `/api/board`、 `/api/logs`、 `/posture`、 `/healthz`、
`POST /api/posts`) は stackstack-onboarding から変わっていません。

## なぜこの作りなのか

- **漏洩サーフェスを消せないのは意図です。** 消せる漏洩を用意して 「消したら得点」 にすると、
  覚えて帰るのは 「証拠を消す」 になります。 この板に delete ルートは無いので、 何かを変える
  唯一の手は鍵ストアを変えることです。 *古い鍵はもう何も開けない* は、 漏れた secret をもう
  1 度提示して採点します ── **認識はされ** (`whoami` は 200 を返し `revoked` と言い)、 かつ
  何も開かないこと。 認識されるが役に立たない、 それが失効の意味で、 削除の意味ではありません。
- **`whoami` は閉じた資格情報も識別します。** 手落ちではありません。 これのおかげで作業順が
  自由になります ── 先に鍵を閉じてから証拠を集めても、 *引き継ぎに残っていた運用キー* は
  ちゃんと答えられます。
- **発行と失効は運用キーにはできません。** 入れ替えようとしている資格情報が自分の後継を発行
  できるなら、 失効はただの儀式です (去り際に新しいものを発行できてしまいます)。 break-glass
  値はコンテナの起動時の出力に 1 度だけ書かれ、 HTTP のどのサーフェスにも出ません ── 走って
  いるアプリケーションからは手が届かない場所にある資格情報の、 小さな模型です。
- **revoke はジョブを孤児にすることを拒みます。** 夜間ジョブがいま使っている鍵を閉じようと
  すると `409 would_orphan_service` が返ります。 本物の IAM は止めてくれません。 ここで 1 度
  だけ止めるのは、 学ぶべきものが順序であって障害ではないからです。
- **`grants: ["*"]` は本当に動きます。** 夜間ジョブは走り、 gate が 4 つ赤なだけで、 そこで
  やめることもできます。 絞ろうとすると、 何が要るのかを知らないと絞れないことに気づきます。
  そして、 それはジョブ自身が教えてくれます ── 拒否されたとき、 action を名指しします。 走ら
  せて拒否を読む、 このループが権限を絞る現場の実際です。
- **ワイルドカードは構造上どれも広すぎます。** ジョブが要る action を持つ service prefix には、
  必ず要らないものが同居しています ── `board:count` の隣に `board:export`、
  `digest:publish` の隣に `digest:recipients`。 だから `board:*` は `*` より 1 文字も安全では
  なく、 *運用キーにできること* はそれらを実 HTTP で全部叩きます。
- **新しい secret を `ops.json` に直書きすると拒否されます。** `identity` は鍵の名前、
  `grants` は action の名前で、 `SSOPS-` で始まる値は `secret_in_manifest` で弾かれます。
  git チェックアウト内のファイルは、 この問題が扱っている 「置いてはいけない場所」 そのもので、
  新しい資格情報がそこに収まって終わる問題は、 教えたいことの逆を教えてしまいます。
- **答えの決め打ちは通りません。** 提出値 5 つはすべてデプロイごとの `FLAG_SEED` からコンテナ
  内で導出され、 うち 4 つは実行時の状態にも依存し、 ポリシー言語には表を書き込む deny 側が
  存在せず、 action カタログ自体にも seed 由来の名前を持つ項目が 1 つ含まれています。

### 回避策の値段

| 回避策 | 落ちる場所 |
| --- | --- |
| 手元の控えを捨てて 「塞いだ」 とする | 鍵ストアは変わらないので漏れた secret はなお通り、 提出する revocation receipt がそもそも存在しない |
| 先に revoke して切替を後回しにする | `409 would_orphan_service`。 別経路でジョブを止めた場合は `key-rotated` (40) と `key-revoked` (45) の正当性前提が偽になる |
| 鍵は替えずにポリシーだけ絞る | `least-privilege` (45) は通るが `key_rotated` と `legacy_revoked` が赤のままで、 合格印 (30) が出ない |
| `grants: []` にする / 運用 API を使わせない | 不在系の 2 つはどちらも、 先に required 側を実 HTTP で実行し、 観測可能な値まで確認する |
| `board:*` / `digest:*` / `*:*` | 同じ prefix の下の sensitive な兄弟がプローブに 200 を返す |
| `readyToken` を控えてから設定を戻す | 合格印は、 答えられた時点で 5 gate 全部を再評価する |

### 採点があなたに対してしないこと

判定が実行するのは 2 種類だけです ── 夜間ダイジェストを 1 回 (追記のみ)、 そして読むだけで
書かない action の実 HTTP プローブ。 スナップショットも復元処理もありません。 復元が要る操作を
採点経路に置いていないからです。 鍵の発行・失効・設定変更は、 あなたが打ったときにだけ起きます。
プローブは `GET /api/ops/journal` に `source: "scorer"` として残るので、 自分の操作と区別
できます。

### 正直さの限界

判定はあなたが動かしているコンテナの中で行われます。 自分のチェックアウトの
`runtimes/stackstack/` を書き換えて image を焼き直せば、 ここのチェックはすべて無効化できます。
このカタログのコンテナ問題すべてに共通することで、 `make local` はピン留めされた `problems/`
submodule からビルドします。

## 採点

`multi-verify`、 チェックポイント 5 つ、 合計 200 点 (Medium ティア)。 誤答は各チェックポイント
2 点 (合計 10 点)。 各チェックポイントにヒントが 2 つあり、 1 つ目は無料、 2 つ目は
18 / 18 / 22 / 22 / 14 ── 問題内のヒントを全部開いても 94 点で、 106 点が残ります。

## コスト

ゼロです。 クラウドアカウントには何もデプロイされず、 コンテナは自分のマシンで動き、
`make local-down` で消えます。 鍵ストア、 journal、 ダイジェスト、 settings override は
コンテナ内だけで、 リポジトリは汚れません。 再作成すると one-time の break-glass
引き継ぎ票も封印された状態に戻ります。

## Battle に引き継がれるもの

正直に、 正しい粒度で。 [`stackstack`](../../battles/stackstack) Battle は CloudFormation の
問題なので、 ここの JavaScript モジュールは 1 行も境界を越えません。 越えるのは形だけです:

- **採点する事実** ── 「公開されてしまった資格情報が何も開かない」 を、 ワークロードを動かした
  まま status が `Inactive` になったアクセスキーとして言い直したもの。
- **順序** ── 発行 → 切替 → 失効を、 資格情報に依存するジョブを落とさずに。 本物の IAM に
  対して、 同じ並びで。
- **絞り込みのループ** ── 業務を走らせ、 拒否されたものを読み、 それだけを許可する。

## 次に

この前に: [`stackstack-onboarding`](../stackstack-onboarding) (同じ板での 15 分の環境確認) と
[`stackstack-ship`](../stackstack-ship) (それを公開側の入口の向こうに置く問題)。
