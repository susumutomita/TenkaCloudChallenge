# 初日の 15 分 — StackStack オンボーディング

> TenkaCloud Challenge · `challenges/stackstack-onboarding` · 難易度 1 · 約 15 分 · `multi-verify` 採点

StackStack 本編の前に走らせる肩慣らし。 **AWS 不要** で、 自分のマシンの Docker コンテナ 1 本だけで完結する (クラウドアカウントも資格情報も要らない)。 謎解きは何もない。 目的は、 これから使う道具 ── ポータル、 アプリ、 ログ、 設定ファイル、 採点 ── を一周しておくことだ。 本番が始まったときに、 そこが初見でないようにする。

同時に環境診断でもある。 `GET /posture` は走っているアプリから実測した 4 つの gate を返し、 4 つとも緑になって初めて合格印の token を出す。 つまり 「この環境は end-to-end で動く」 が、 願望ではなく機械可読な事実になる。

## 何が動くか

| 場所 | 中身 |
| --- | --- |
| **自分のマシン (Docker)** | StackStack 共通の **ベースアプリ** ── 小さな Node 製掲示板 |
| `127.0.0.1:18080` | 掲示板 (参加者が使うアプリ) |
| `127.0.0.1:18081` | TenkaCloud の採点が委譲する loopback `/verify` |
| 板の `docs` (API コンソール) | アプリの設定を見る・変える・初期状態へ戻す ── リポジトリのファイルは触らない |

image は StackStack 系問題が共有する [`runtimes/stackstack/`](../../runtimes/stackstack) から作る。 board serial・boot-check の値・合格印 token はすべて、 deploy ごとにランダムな `FLAG_SEED` からコンテナ内で導出する。 だから答えはこのリポジトリに存在せず、 2 つの deploy が同じ答えを持つこともない。 公開ポートはどちらも `127.0.0.1` のみ。

## ミッション

チェックポイント 4 つ、 各 25 点。

| チェックポイント | 何を聞かれるか | 答えがある場所 |
| --- | --- | --- |
| 掲示板に手が届く | 板の serial | 板に印刷されている |
| アプリのログを読む | 起動ログ行の中の値 | `GET /api/logs` |
| 投稿を受け付ける | 自分が投稿したタイトル | 自分で決める |
| 本番前チェックの合格印 | 環境の合格印 token | `GET /posture` (全 gate が緑になったら) |

## 手順

1. 起動する。

   ```
   make local PROBLEM=stackstack-onboarding
   ```

   Codespaces でも同じコマンドでよい。 ポート転送はポータル側がやるし、 板のリンクはすべて相対 URL なので転送された origin でもそのまま動く。

2. ポータルに空でない鍵でログインし、 `Web` endpoint を開く。 板の上のほうに serial が出ている。

   ```
   board serial: SS-1a2b3c4d
   ```

   これを (`SS-` 込みで) **掲示板に手が届く** に提出する。

3. アプリ自身のログを読む。

   ```
   curl -s http://127.0.0.1:18080/api/logs | jq -r '.lines[].message'
   ```

   起動時の行に `boot ok boot-check=<値>` がある。 `=` の後ろの値だけを **アプリのログを読む** に提出する。 `docker compose logs` にも同じ行が出る。

4. 板はまだ投稿を受け付けておらず、 そのことが板自身に書いてある。 開けるのは板の API コンソール (`docs`) から ── **リポジトリのファイルは書き換えない**。

   ```
   curl -X PATCH http://127.0.0.1:18080/api/config \
     -H 'content-type: application/json' \
     -d '{"acceptingPosts": true}'
   ```

   再起動は要らない (即反映)。 変更はコンテナの中にだけ置かれるので、 リポジトリは汚れない。 そして投稿する。

   ```
   curl -X POST http://127.0.0.1:18080/api/posts \
     -H 'content-type: application/json' \
     -d '{"author":"you","title":"hello","body":"first post"}'
   ```

   使ったタイトルを **投稿を受け付ける** に提出する。 このチェックポイントは両方を見ている ── 設定が開いていること、 そして板が最初から持っていたのではない投稿が存在すること。

5. posture を確認する。

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "board_visited": true,
       "logs_read": true,
       "posts_open": true,
       "post_created": true
     },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   `readyToken` を **本番前チェックの合格印** に提出する。 まだ `null` なら、 false の gate がそのまま次にやることだ。

6. 設定を戻すのは、 合格印を提出した **後** にする。 先に閉じると `posts_open` が false に戻り、 token が通らなくなる。 戻すのも API から ── 変えた分を全部捨てて初期状態に戻る。

   ```
   curl -X DELETE http://127.0.0.1:18080/api/config
   ```

## 板の経路

| 経路 | 用途 |
| --- | --- |
| `GET /` | 板 (ページとして) |
| `GET /api/board` | タイトル・serial・投稿受付の可否・全投稿 |
| `GET /api/logs` | アプリの直近ログ行 (`?limit=` で広げられる) |
| `GET /posture` | 実測した 4 gate と、 緑になったときの合格印 token |
| `GET /healthz` | 死活確認と、 設定エラーがあればその内容 |
| `GET /docs` | API コンソール ── ここに並ぶ全経路を画面から実行できる |
| `GET/PATCH/DELETE /api/config` | 設定を見る・変える・初期状態へ戻す |

コンテナを再起動すると環境チェックはやり直しになる。 gate は走っているアプリからの実測なので、 再起動で全部 false に戻り、 投稿も消える。 すでに正解したチェックポイントの得点はポータル側に残るが、 合格印にはもう一度 4 つの gate を緑にする必要がある。
| `POST /api/posts` | 投稿する ── 板が閉じている間は `409` |

## なぜ申告ではなく実測なのか

`acceptingPosts` を `true` にしただけでは通らない。 そのうえで投稿が実際に通り、 いま板に存在することまで確かめている。 設定と挙動は現実にずれる ── 「有効にしたはずの認証が効いていない」 はまさにこの形だ ── だから見るべきは設定値ではなく結果のほうになる。 StackStack の gate は、 AWS 上のものも含めて全部この作りになっている。

編集中に JSON を壊しても隠れない。 `GET /healthz` が `503` とパースエラーを返し、 同じエラーが `/api/logs` にも出る。

## 採点

`multi-verify`。 チェックポイント 4 つ × 25 点 = 100 点 (Easy tier)。 誤答は前半 3 つが 1〜2 点、 合格印は 0 点。 各チェックポイントにヒントが 2 つあり、 1 つ目は減点なし、 2 つ目が 8 点。

## コスト

ゼロ。 クラウドには何も作らない。 コンテナは自分のマシンで動き、 `make local-down` で消える。

## 次にやること

本編は [`stackstack`](../../battles/stackstack) Battle。 同じ掲示板を本番品質まで持っていく ── データ復元・認証・レート制限・監査・DB 移行を、 障害を挟みながら進める。
