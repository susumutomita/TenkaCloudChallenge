# 誰に見せるかを決める — StackStack safe exposure

> TenkaCloud Challenge · `challenges/stackstack-safe-exposure` · 難易度 3 · 約 60〜75 分 · `multi-verify` 採点

板は動いていて、 これから取引先に渡される。 足りていないのは 「誰に何を見せるか」 の線引きで、
それを書く 1 枚のファイルは空のまま残されている。

**AWS 不要**。 手元の Docker コンテナ 1 つ、 クラウドアカウントも資格情報も要らない。
模しているのは認可基盤 ── 4 つのアカウント、 それぞれ owner と tenant と visibility を持つ
4 件の文書、 そしてリクエストごとに読み直される 1 枚の宣言的な access ドキュメントが、
誰がどれに届くかを決める。

## 何がデプロイされるか

| どこ | 何 |
| --- | --- |
| **手元のマシン (Docker)** | 共有の **StackStack ベースアプリ** を `SCENARIO=safe-exposure` で起動 |
| `127.0.0.1:18080/portal` | レビュー画面 ── ルールの書き方・使える require・ステージング鍵・gate |
| `127.0.0.1:18080/portal/review` | 同じものを probe 1 本ずつ、 決めた rule 付きで |
| `127.0.0.1:18080/` | 板そのもの。 これまでの StackStack 問題から変わっていない |
| `127.0.0.1:18081` | TenkaCloud の採点が委譲する loopback の `/verify` |
| `problems/challenges/stackstack-safe-exposure/local/access/access.json` | access ドキュメント ── **あなたの** ファイル、 読み取り専用でマウント |
| `problems/challenges/stackstack-safe-exposure/local/config/app.json` | 板自身の設定。 この問題の対象ではない |

image は StackStack 全問題で共有している [`stackstack-base/`](../../stackstack-base) から
ビルドされる。 4 つの API キー・下書きの id・2 つの管理番号はデプロイごとにランダムな
`FLAG_SEED` からコンテナ内で導出され、 gate の受領証はブート時に別途生成される秘密から導出
される。 答えはこのリポジトリに 1 つも入っておらず、 2 つのデプロイが同じ答えを持つことも
ない。 どちらのポートも `127.0.0.1` にだけバインドされている。

### 模していることについて正直に

ここに ID プロバイダは無い。 アカウントとは、 コンテナ内のテーブルから解決される
`Authorization: Bearer sk_...` の鍵であって、 Cognito でも ALB authenticator でもない。
同じなのは採点している性質のほうだ ── *有効な principal を持たないリクエストが管理オブジェクト
に到達しない*、 *オブジェクト自身の属性が判定に参加する*。

| ここ | 現実の対応 |
| --- | --- |
| 4 つの Bearer 鍵 | Cognito / ALB authenticator が解決する principal |
| `access.json` の順序つき rule | 宣言的ポリシー ── IAM / OPA / ALB listener rule |
| `owner` / `tenant` / `shared` | リソース属性に基づく認可 (ABAC) |
| `/portal/admin/*` | 管理コンソール・運用 API |
| `GET /portal/healthz` | ALB / 外形監視のヘルスチェック経路 |

**板そのものは access ドキュメントの管轄外。** `GET /` `/api/board` `/api/logs` `/healthz`
`/posture` `POST /api/posts` は共有ベースアプリのルートで、 scenario がこれらを再宣言すると
boot 時に失敗する。 だからこの問題が締めるのは `/portal` 以下だけ。 ドキュメントはそれより
遠くには届かないし、 この README も届くふりはしない。

**`/portal` と `/portal/review` は決して governed にならない。** 他を全部締め出す policy を
書いても計器盤は生き残る必要がある ── そうでなければ、 最初の締めすぎが 「なぜそうなったか」
を説明できる唯一の場所も一緒に消してしまう。

## ミッション

checkpoint 4 つ、 200 点:

| checkpoint | 点 | 求めるもの |
| --- | --- | --- |
| 取引先の下書きに書かれていた管理番号 | 30 | 読めてしまった `TC{exposed_...}` |
| 管理画面を管理者だけに戻す | 50 | `GET /posture` の `admin_sealed` 受領証 |
| 下書きを持ち主と共有先だけに戻す | 60 | `GET /posture` の `drafts_scoped` 受領証 |
| 公開範囲レビューの合格印 | 60 | `GET /posture` の `readyToken` |

## 手順

1. 起動する:

   ```
   make local PROBLEM=stackstack-safe-exposure
   ```

2. `http://127.0.0.1:18080/portal` を開く。 ルールの書き方、 使える require、 ステージング用
   の 4 つの鍵、 5 つの gate の現状が全部ここにある。 次に probe 1 本ずつの状態を見る:

   ```
   curl -s http://127.0.0.1:18080/portal/review | jq '.groups | map_values(.ok)'
   ```

   ```jsonc
   {
     "service_intact": true,
     "drafts_usable": true,
     "drafts_scoped": false,
     "admin_available": true,
     "admin_sealed": false
   }
   ```

   全部動いている。 何も守られていない。 それが前任の SRE が残した状態。

3. いまどこまで届いてしまうのかを自分の手で確かめる。 下書きは 1 件ずつ 「誰のものか」 と
   「どのテナントのものか」 を持っている:

   ```
   curl -s -H "Authorization: Bearer <ステージング鍵>" http://127.0.0.1:18080/portal/drafts | jq
   curl -s http://127.0.0.1:18080/portal/admin/audit | jq '.decisions | length'
   ```

4. access ドキュメントを書き直す:

   ```
   problems/challenges/stackstack-safe-exposure/local/access/access.json
   ```

   再起動は要らない ── リクエストごとに読み直される。 読み込めないドキュメントは 「黙って
   閉まる」 のではなく障害として出る: governed なルートは全部 `503 policy_error` を返し、
   問題点を名指しし、 `/portal` は開いたまま何が悪いかを教える。

5. 赤い gate を開いて、 何が落ちているかを読む:

   ```
   curl -s http://127.0.0.1:18080/portal/review | jq '.groups.drafts_scoped.probes[] | select(.ok|not)'
   ```

   ```jsonc
   {
     "name": "sre-anzu reads pm-kenji's private draft (same tenant)",
     "object": "kenji-private",
     "expected": "403",
     "got": "200",
     "ok": false,
     "decidedBy": "default"
   }
   ```

6. posture を見て提出する:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": { "service_intact": true, "drafts_usable": true, "drafts_scoped": true,
                "admin_available": true, "admin_sealed": true },
     "tokens": { "drafts_scoped": "TC{...}", "admin_sealed": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   受領証はその gate が true の間だけ出る。 `readyToken` は 5 つとも true の間だけ。

7. チェックアウトを戻すのは、 合格印を提出した **あと** で:

   ```
   git -C problems checkout -- challenges/stackstack-safe-exposure/local/
   ```

## access ドキュメント

```jsonc
{
  "defaultEffect": "allow" | "deny",
  "rules": [
    {
      "id":      "人が読むための名前 (任意)",
      "effect":  "allow" | "deny",
      "methods": ["GET", "POST", "DELETE"],   // または ["*"]
      "path":    "/portal/draft",             // または "/portal/admin/*"
      "require": []
    }
  ]
}
```

- rule は上から順に見る。 **method と path と require が全部そろった最初の rule** が決める。
  path は合うが require が足りない rule は 「合致しない」 ので次の rule へ進む ── これが、
  同じ path に 2 本置いて 「自分のもの、 または自分のテナントで共有されたもの」 と書ける理由。
- どれにも合致しなければ `defaultEffect` が決める。
- `path` は完全一致。 ワイルドカードは末尾の `/*` だけで、 `/portal/admin/*` は
  `/portal/admin/` より長いパスすべてに合致し、 `/portal/admin` 自身には合致しない。
- `require: []` は 「条件なし」。 対象が 1 件に定まらないルート (一覧・作成・admin) では
  `owner` / `tenant` / `shared` は必ず false ── 無いものの属性を要求する判定は、 黙って通る
  のではなく閉じる側に倒れる。

| `require` | 成り立つとき |
| --- | --- |
| `anonymous` | このアプリが知っている鍵を出していない |
| `authenticated` | このアプリが知っている鍵を出している |
| `role:member` / `role:admin` | その鍵の role |
| `subject:<id>` | その鍵がちょうどこの 1 人のもの |
| `owner` | 対象の `owner` が呼び出し元 |
| `tenant` | 対象の `tenant` が呼び出し元のテナント |
| `shared` | 対象の `visibility` が `team` |

これ以外は **理由つきで拒否** され、 直すまでドキュメントは読み込まれない ── `client-ip:` と
`ip:` を含む。 リクエストは全部公開ポート越しに届くので、 このアプリが見えるアドレスは手前の
proxy のものであって呼び出し元のものではない。 送信元アドレスの条件は 「何も決めていないのに
決めたように見える」 ── 条件が無いより悪い。

## この問題が足すサーフェス

| ルート | governed | 用途 |
| --- | --- | --- |
| `GET /portal` | いいえ | レビュー画面 |
| `GET /portal/review` | いいえ | probe 1 本ずつ、 期待と実際と決めた rule |
| `GET /portal/healthz` | はい | 監視経路 |
| `GET /portal/me` | はい | その鍵が誰か |
| `GET /portal/drafts` | はい | 一覧。 単体ルートと同じ判定で 1 件ずつ絞られる |
| `POST /portal/drafts` | はい | 下書きを書く (owner と tenant は鍵から。 body からは取らない) |
| `GET /portal/draft?id=d-…` | はい | 下書き 1 件 |
| `DELETE /portal/draft?id=d-…` | はい | 下書きを 1 件消す |
| `GET /portal/admin/handover` | はい | 前任者の引き継ぎ |
| `GET /portal/admin/audit` | はい | この板が下した判定の記録 |
| `GET /portal/admin/drafts` | はい | 全テナントの下書き |
| `DELETE /portal/admin/draft?id=…` | はい | 管理者として下書きを消す |

## なぜこう作ってあるか

もっともらしい誤答は、 どれももっともらしく見える。 そこが本題。

- **`defaultEffect: "deny"` だけ書く。** 一語で済むし、 AI に 「これを安全にして」 と言うと
  最初に返ってくる答えでもある。 漏れは止まる。 業務も止まる ── `service_intact` と
  `drafts_usable` と `admin_available` が同時に赤になり、 sealing の checkpoint 3 つが全滅
  する。 5 つの gate のうち 「閉じる」 側が 2 つ、 「動いている」 側が 3 つなのは意図的。
- **全ルートに `require: ["authenticated"]` を 1 本。** 鍵の無いリクエストは止まる。 それ以外
  は何も変わらない ── 落とすべき probe は全員、 このアプリが知っている鍵を出しているから。
  `drafts_scoped` と `admin_sealed` はさっきと同じだけ赤いまま。 それが学ぶところ。
- **既知の 1 人に固定する ── `require: ["subject:sre-anzu"]`。** わざと書けるようにしてある。
  失敗を仮定ではなく実演にするため。 `service_intact` は他の 3 つの identity が自分の文書を
  読むことを見ているし、 `drafts_usable` は CTO が今日入れた取引先が書けることを要求する。
- **テナント単位にする ── `require: ["authenticated", "tenant"]`。** 「マルチテナントを正しく
  やった」 感のある、 もっともらしい惜しい答え。 同一テナントの private を 1 件、 まさにこの
  ために置いてある: `drafts_scoped` は赤のまま。
- **`require: ["authenticated", "owner"]` に締めすぎる。** 漏れは閉じて、 `service_intact` が
  赤くなる。 pm-kenji は runbook をチームに共有しているから。 正解はポリシーであって、
  最大値ではない。
- **探索中に見えた id を allowlist する。** `drafts_usable` は probe の中でその場で下書きを
  書き、 読み返し、 消す ── ポリシーを書いた時点に存在しなかった id で。 最初からある 4 件の
  id も `FLAG_SEED` 由来なので、 リポジトリ側で allowlist を用意することもできない。
- **監視経路を閉じる。** `service_intact` が赤くなる。 「安全にするために全部閉じました」 は、
  この問題が名前を取っている失敗そのもの。
- **送信元アドレスで絞る。** 理由つきで拒否され、 消すまでドキュメントは読み込まれない。
- **漏れている下書きを消して隠す。** `service_intact` (取引先が自分の文書を読めない) と
  `admin_available` (4 件が 4 件でない) が赤くなる。
- **直して token をコピーしてから元に戻す。** どの checkpoint も、 答えるその瞬間に実際の
  リクエストを送り、 gate を全部評価し直す。 受領証はアプリの状態についての証拠であって、
  成績ではない。

### 採点があなたに対してやらないこと

checkpoint が送るリクエストは **全部 GET**。 作成も削除もしない。 誤答でも、 再送でも、
同じ checkpoint を 2 回採点しても、 環境は変わらない。

gate 側の probe は書き込む ── 下書きを 1 件書いて、 読み返して、 消す ── ので、 評価は最初の
probe から最後まで同期実行になっている。 途中で他のリクエストが走る瞬間が無いので、 あなたが
見る画面にそれが写ることはないし、 あなたが書いたものには触れない。 採点が残すのは
`GET /portal/admin/audit` のエントリだけ。 あれは本物のリクエストで、 監査記録が監査者だけ
そっと省くのは間違った教え方だから、 そのまま残る。

### 答えがこのリポジトリにあることについて

このカタログは OSS で、 `scripts/stackstack-safe-exposure.test.ts` には通る access ドキュメント
が入っている。 同じツリーがあなたのチェックアウトにも `problems/` として入っている。 隠せない
以上、 隠したふりはしない ── ここに書き、 ヒントもそれ込みで値付けしてある (無料のヒントが
1 つも無いのはそのため)。 reference policy を持たないテストは 「この checkpoint は正しい答えを
**通す**」 を証明できず、 その保証は答えを見つけにくくすることより価値がある。

### 正直さの限界

判定はあなたが動かしているコンテナの中で計算される。 自分のチェックアウトの
`stackstack-base/` を書き換えて image を焼き直せば、 ここの検査は全部無効化できる。 このカタログ
のコンテナ問題すべてに共通することで、 `make local` は pin された `problems/` サブモジュール
からビルドする。

## 採点

`multi-verify`、 checkpoint 4 つ、 合計 200 点 (Medium ティア)。

| checkpoint | 点 | 誤答 | ヒント |
| --- | --- | --- | --- |
| 取引先の下書きに書かれていた管理番号 | 30 | 2 | `4 / 9` |
| 管理画面を管理者だけに戻す | 50 | 3 | `5 / 7 / 11` |
| 下書きを持ち主と共有先だけに戻す | 60 | 3 | `6 / 9 / 13` |
| 公開範囲レビューの合格印 | 60 | 2 | `8 / 15` |

全部開いても 87 で、 113 は残る。 無料のヒントは 1 つも無い ── 理由は上の
「答えがこのリポジトリにあることについて」 のとおり。

## コスト

ゼロ。 クラウドアカウントには何もデプロイされない。 コンテナは手元で動き、 `make local-down`
で消える。 下書きも判定記録もコンテナのメモリ上だけにあるので、 片付けたあとに残るのは自分の
チェックアウトの 2 ファイルだけ。 それも
`git -C problems checkout -- challenges/stackstack-safe-exposure/local/` で戻せる。

## Battle への引き継ぎ

正直に、 正しい粒度で: この問題の検証ロジックは [`stackstack`](../../battles/stackstack) とは
**まだ共用していない**。 あの Battle は `phased-polling` の CloudFormation 問題で、 phase は
production-ramp と incident-response の 2 つ。 Expose フェーズは存在せず、 EC2 上のワーク
ロードは別のアプリで、 access ドキュメントを読むものは何も無い。 あとで共用できるようにここで
作ってあるのは分離のほうだけ ── probe 群は宣言的な表で、 `runProbe` が実行器なので、 同じ形の
表を ALB の URL に向けるのが移植の全部になる。 Expose phase を足して EC2 のワークロードを
置き換えるのは別の作業で、 この問題はそれが済んだとは主張しない。

## 次

この前に: [`stackstack-onboarding`](../stackstack-onboarding) (環境確認) と
[`stackstack-ship`](../stackstack-ship) (板を外に出す)。 このあとの本編は
[`stackstack`](../../battles/stackstack) Battle。
