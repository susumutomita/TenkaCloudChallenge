# はじめてのリクエスト — StackStack 章 0

> TenkaCloud Challenge · `challenges/stackstack-first-request` · 難易度 1 · 約 10 分 · `multi-verify` 採点

stackstack-route の章 0。 Web アプリと HTTP で会話した経験がゼロでも始められる、 リクエスト → レスポンスの一往復を 3 回まわす 10 分。 **AWS 不要** で、 自分のマシンの Docker コンテナ 1 本だけで完結する (クラウドアカウントも資格情報も課金も無い)。 壊しても、 コンテナを作り直せば元に戻る。

謎解きは何もない。 目的は「読む・断られて直す・書く」の 3 往復を、 全部ブラウザの API コンソールから自分の手で完了することだ。

## 何が動くか

| 場所 | 中身 |
| --- | --- |
| **自分のマシン (Docker)** | StackStack 共通の **ベースアプリ** ── 小さな Node 製掲示板 |
| `127.0.0.1:18080` | 掲示板 (参加者が使うアプリ) |
| `127.0.0.1:18081` | TenkaCloud の採点が委譲する loopback `/verify` |
| 板の `docs` (API コンソール) | 「任意の API を試す」 ── この問題の 3 経路をここから実行する |

image は StackStack 系問題が共有する [`runtimes/stackstack/`](../../runtimes/stackstack) から作る (`SCENARIO=first-request`)。 postcard の合言葉・door token・guestbook receipt・一周の token はすべて、 deploy ごとにランダムな `FLAG_SEED` からコンテナ内で導出する。 だから答えはこのリポジトリに存在せず、 2 つの deploy が同じ答えを持つこともない。 公開ポートはどちらも `127.0.0.1` のみ。

## ミッション

チェックポイント 4 つ、 各 25 点。

| チェックポイント | 何を聞かれるか | 答えがある場所 |
| --- | --- | --- |
| 葉書を読む | `token` (`postcard-...`) | `GET /api/postcard` のレスポンス |
| 断られて、 直す | `token` (`TC{door_...}`) | 正しい `?key=` を付けた `GET /api/door` のレスポンス |
| 芳名帳に書く | `receipt` (`TC{guestbook_...}`) | 通った `POST /api/guestbook` の 201 レスポンス |
| 一周の証明 | `readyToken` (`TC{ready_...}`) | `GET /posture` (3 gate が全部緑になったら) |

## 手順

1. 起動する。

   ```
   make local PROBLEM=stackstack-first-request
   ```

   Codespaces でも同じコマンドでよい。 板のリンクはすべて相対 URL なので、 転送された origin でもそのまま動く。

2. ポータルに空でない鍵でログインし、 `Web` endpoint から板を開く。 板に CTO の投稿が 2 つあり、 今夜の宿題 (3 経路) が書いてある。 板の `docs` を開く。

3. 「任意の API を試す」で `GET /api/postcard` を実行する。 レスポンスの `token` を **葉書を読む** に提出する。

4. `GET /api/door` を実行する。 400 が返るが、 `detail` に直し方が書いてある ── パスを `/api/door?key=<葉書の token>` にしてもう一度。 200 の `token` を **断られて、 直す** に提出する。

   ターミナル派なら同じことがこうなる (必須ではない)。

   ```
   curl -s "http://127.0.0.1:18080/api/door?key=postcard-xxxxxxxxxxxx"
   ```

5. `POST /api/guestbook` に body を付けて実行する。

   ```json
   {"name": "あなたの名前", "message": "ひとこと"}
   ```

   201 の `receipt` を **芳名帳に書く** に提出する。 400 が返るときは `detail` が理由を教えてくれる。

6. `GET /posture` を実行する。

   ```jsonc
   {
     "gates": {
       "postcard_read": true,
       "door_opened": true,
       "message_left": true
     },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   `readyToken` を **一周の証明** に提出する。 まだ `null` なら、 false の gate がそのまま残りの宿題だ。

## この問題が足している経路

| 経路 | 用途 |
| --- | --- |
| `GET /api/postcard` | 読むだけの一往復。 `token` が door の合言葉 |
| `GET /api/door` | `?key=` 無しは 400 (直し方つき)、 正しい合言葉で 200 と `token` |
| `GET /api/guestbook` | いままでの記帳一覧 |
| `POST /api/guestbook` | 記帳する ── 通れば 201 と `receipt`、 形が違えば 400 と理由 |

板そのものの経路 (`/api/board`、 `/api/logs`、 `/posture`、 `/docs` など) は [`stackstack-onboarding`](../stackstack-onboarding) と同じ。 この問題では設定編集は要らない (出荷設定で投稿は最初から開いている)。

コンテナを再起動すると gate は実測なので全部 false に戻る。 すでに正解したチェックポイントの得点はポータル側に残るが、 一周の証明にはもう一度 3 つの gate を緑にする必要がある。

## 採点

`multi-verify`。 チェックポイント 4 つ × 25 点 = 100 点 (Easy tier)。 誤答の減点は前半 3 つが 1〜2 点、 一周の証明は 0 点。 各チェックポイントにヒントが 2 つあり、 1 つ目は減点なし、 2 つ目が 8 点。

## コスト

ゼロ。 クラウドには何も作らない。 コンテナは自分のマシンで動き、 `make local-down` で消える。

## 次にやること

[`stackstack-onboarding`](../stackstack-onboarding) (初日の 15 分)。 同じ板を、 今度はログと設定まで含めて一周する。
