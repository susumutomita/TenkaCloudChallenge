# 資料棚の点検 ── 抜け道をたどり、直したことを証明する

> TenkaCloud Challenge · `challenges/php-attachment-viewer-lab` · 難易度 3 · 約 60 分 · `multi-verify` 採点 (5 チェックポイント、200 点) · status `draft`

[`wp2shell-local-lab`](../wp2shell-local-lab/) と同じ型の、ローカル完結の攻撃 → 修正ラボ。
自作アプリを第 1 段階で攻撃し、第 2 段階で設定から直し、第 2 段階のチェックポイントはすべて
生きたアプリを採点側がたたき直して判定する。セキュリティベンダーの勧告は「社内ポータルの
資料閲覧が、資料棚の外のファイルまで届く」。本番を触る前に、SRE が同じ構成の使い捨てラボで
再現し、塞ぎ、後始末をして、同じ手口が通らないことを証明する。

**すべて自作のシミュレータです。** ポータルは公式 `php:8` CLI イメージ (ダイジェスト固定) 上の
小さな PHP ファイル 1 つ。実在の CMS でも、実在製品のコードでも、特定の CVE の写しでもない。
仕込んだ欠陥は 1 種類だけ ── 閲覧ページが、受け取った名前を棚のパスにつないだ先がどこを
指すか確かめずに開くこと。

## 参加者の体験

| | |
| --- | --- |
| 役割 | 12 人の会社の社内ポータルを預かる、オンコールの SRE |
| 最初に見える症状 | ベンダー勧告「資料閲覧に棚の外へ出る経路がある」。棚の `manual.txt` に構成が書いてある: `attachments/` が棚、その隣の `private/config.ini` に監査トークン。 |
| 最初の一手 | `/attachment?file=manual.txt` を開き、`file` の値を変えてみる。 |
| 成功の見え方 | 第 1 段階: 閲覧ページに private の設定ファイルが表示され、`audit_token = "TC{...}"` がある。そのトークンで `/internal/audit` が開き、誰も作っていないアカウントが見える。第 2 段階: 同じ名前が 403 になり、`manual.txt` は開き、アカウントは消え、漏れたトークンは 401 になる。 |

## 2 つの段階

| | 第 1 段階 ── 攻める | 第 2 段階 ── 守る |
| --- | --- | --- |
| 出発点 | 未認証 | SRE コンソールのトークンを持つ (`/admin` に平文で表示。ラボの便宜) |
| すること | 閲覧ページに棚の外のファイルを開かせ、監査トークンを読む | 閲覧ページのパス方針を切り替え、残置アカウントを消し、監査トークンを作り直し、同じ手口を再現して弾かれることと普段の閲覧が壊れていないことを確かめる |
| 証拠 | 見つけた文字列 | 採点器がたたき直した **生きた状態**。提出した設定値の見た目は見ない |

**順番が大事。** `realpath` 方針は第 1 段階の合言葉への唯一の経路を閉じるので、第 1 段階を先に終える。

## チェックポイント (multi-verify、200 点)

| チェックポイント | 何を証明するか (採点器が実際にすること) | 点 |
| --- | --- | ---: |
| `read-outside` | 提出された `TC{...}` が、`FLAG_SEED` から導出した監査トークンと一致する。 | 50 |
| `fix-viewer` | 「棚の外へ出る」書き方 5 通り (`../`、`....//`、`./../`、`../../app/`、`..\/`) を生きた閲覧ページに送り、どれも 200 を返さず private ファイルの `audit_token =` 行も返さないこと。さらに `manual.txt` が 200 で中身を返すこと。 | 50 |
| `cleanup-leftover` | `/admin/audit` が残置アカウント無しを報告し、**かつ** 現在のトークンで開いた `/internal/audit` の一覧に `svc-backup` が無い。 | 30 |
| `rotate-token` | トークン版数が 1 以上で、版 0 のトークン (第 1 段階の合言葉) は `/internal/audit` で 401、現在のトークンは 200。 | 30 |
| `site-healthy` | `/`、`/documents`、`/attachment?file=manual.txt`、`/admin` がすべて 200 で、期待する中身を返す。 | 40 |

天井は `fix-viewer`。コンソールの `pathPolicy` は 3 つ: `none` (初期状態)、`strip-dotdot`
(`../` を 1 回消すだけ ── `....//` で回り込まれる、もっともらしい応急処置)、`realpath`
(つないだパスを解決してから棚の中にあることを要求する)。採点器は選ばれた値を読まず、
再現攻撃を生き残るのは `realpath` だけ。ヒントは、仕組み (`..` は一つ上) → 小さなパスでの
例 → そのままのコマンド、の階段で、ペナルティ合計は SCORING.md の上限内 (100 中 99)。

## 配置されるもの

Dockerfile 1 つから 2 コンテナ、ループバックの 2 ポート、DB 無し、他サービス無し:

| 場所 | 中身 |
| --- | --- |
| `surface` · `127.0.0.1:18080` | `php:8.4.27-cli-alpine` (ダイジェスト固定)。PHP 内蔵サーバが `public/index.php` をルータとして動く。トップ、`/documents`、閲覧 `/attachment`、`/internal/audit`、SRE コンソール `/admin/*`。`www-data` で実行、ルート FS は読み取り専用、`/app/private` と `/app/state` は tmpfs。 |
| `verifier` · `127.0.0.1:18081` | `node:22` (ダイジェスト固定) で `verify/server.mjs`。compose ネットワーク経由で `http://surface:8080` に到達。`node` で実行、読み取り専用。 |

2 つが共有するのは `FLAG_SEED` だけ。起動時に `bin/bootstrap.php` がコンソール状態と
`private/config.ini` (その `audit_token` が第 1 段階の合言葉) を surface の tmpfs に書く。
検証器は同じ seed から合言葉とコンソールトークンを導出するので、ファイル・ボリューム・
プロセスは何も共有せず、参加者イメージには秘密が入らない。

## 参加者の道筋 (compose スタックに対して実際に実行したもの)

```sh
BASE=http://127.0.0.1:18080
curl "$BASE/"                                   # 棚の一覧と閲覧 URL の形
curl "$BASE/attachment?file=manual.txt"         # 構成: attachments/ と private/config.ini
curl -g "$BASE/attachment?file=../private/config.ini"   # 200; audit_token = "TC{escape_...}"
curl -g "$BASE/internal/audit?token=TC{escape_...}"      # アカウント一覧に svc-backup (admin)
curl "$BASE/admin"                              # コンソールトークンと操作一覧
H="Authorization: Bearer <コンソールトークン>"
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"set-config","pathPolicy":"strip-dotdot"}'
curl -g -o /dev/null -w '%{http_code}\n' "$BASE/attachment?file=../private/config.ini"      # 404
curl -g -o /dev/null -w '%{http_code}\n' "$BASE/attachment?file=....//private/config.ini"   # 200 (まだ漏れる)
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"set-config","pathPolicy":"realpath"}'
#   -> どちらの書き方も 403、manual.txt は 200
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"remove-leftover-account"}'
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"rotate-audit-token"}'   # 旧トークン -> 401
```

各チェックポイントを `POST 127.0.0.1:18081/verify` に
`{"checkpointId":"...","submission":"..."}` で送ると、この順に `correct: true` が返った:
`read-outside` (合言葉)、`fix-viewer` は `realpath` 後のみ (`none` と `strip-dotdot` では
false)、`cleanup-leftover`、`rotate-token`、`site-healthy`。`curl -g` は必須 ── 付けないと
curl の URL グロブが `TC{...}` の波括弧を落とす。

## 安全境界

- **実行も外向き通信も無い。** PHP は `exec`、`system`、`shell_exec`、`passthru`、`popen`、
  `proc_open`、`eval`、`curl_init`、`fsockopen`、`mail` を呼ばない。検証器は `child_process`
  を読み込まない。`tests/boundary.test.mjs` が出荷ソースを grep する。
- **ループバックのみ。** 公開ポートはどちらも `127.0.0.1` に束縛。compose のテストが確認する。
- **非 root、読み取り専用、権限無し。** `USER www-data` / `USER node`、`read_only: true`、
  `cap_drop: [ALL]`、`no-new-privileges`、ホストのバインドマウント無し、`docker.sock` 無し。
  実行中コンテナで確認: `id` → uid 82、`touch /app/x` → read-only file system。
- **既定の seed 無し。** 両サービスとも `${FLAG_SEED:?}`。未設定だと `docker compose config`
  が失敗する。フラグ形の文字列はコミットされていない (boundary テストが検査)。
- **参加者面と検証器の権威は別コンテナ。** 検証器が参加者から受け取るのは surface の HTTP 挙動だけ。
- **欠陥は閉じている。** 閲覧ページはファイルを読むだけで、書かず、任意のディレクトリを
  一覧せず、実行しない。private のファイルに入っているのは seed から導出したラボ用トークンだけ。

## 費用のかかる資源

無し。すべて参加者自身のマシンの Docker 上で動く。クラウドアカウント、Region、有料サービスは
関係しない。セッション長は参加者の都合だけで決まる。

## 後始末

```sh
docker compose -p php-attachment-viewer-lab -f local/docker-compose.yml down --volumes --rmi local
```

(このディレクトリで `make down` でも同じ。) tmpfs の状態はコンテナと一緒に消える。

## ローカル検証

問題のテスト (`php` が PATH にあること、リポジトリ直下で `make install` 済みであること):

```sh
cd challenges/php-attachment-viewer-lab
make test            # node --test tests/*.test.mjs
```

`tests/lab.test.mjs` は本物のポータル (`php -S`) と本物の検証器を空いているループバック
ポートで起動し、次を検査する: 初期状態で第 1 段階が通ること、`/verify` が `checkpointId`
を echo すること、誤答・不成立の応答に seed・合言葉・コンソールトークン・`TC{` が含まれ
ないこと、`strip-dotdot` が `....//` で回り込まれ `fix-viewer` が false のままなこと、
`realpath` が 5 通りをすべて断りつつ `manual.txt` を開けること、後片付けと作り直しが生きた
状態で判定され旧トークンが 401 になること。`tests/boundary.test.mjs` は上の安全境界を守る。
このブランチでの結果: 12 passed、0 failed。

フルスタック:

```sh
export FLAG_SEED="$(openssl rand -hex 32)"
docker compose -p php-attachment-viewer-lab -f local/docker-compose.yml up --build -d --wait
```

両コンテナが `healthy` になり、上の道筋で全チェックポイントが通った。ルートの
`make agent-gate` (schema、日英 README、相互参照、採点規定) はこの問題込みで通る。

未実施: この問題を選んだ TenkaCloud の `make local` セッション (compose はカタログの他の
`docker`/`compose` 問題と同じ契約に従うが、TenkaCloud ポータル経由の通しプレイは任意の
イベントリハーサルであり、merge の必須条件ではない)。
