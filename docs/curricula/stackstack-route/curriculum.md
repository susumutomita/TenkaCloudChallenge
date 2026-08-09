# StackStack ルート

Issue 397。**未経験の人が StackStack を解けるようになる**ことだけを判定基準にした学習ルート。

`track.id` は `stackstack-route`。`index.json` から機械可読で、ポータルの「次にやること」と「講座トラック」画面はこの順序を読む。

## なぜ必要だったか

順序は散文としては既に存在していた。`stackstack-onboarding` の instructions にこう書いてある。

> 終わったら次は StackStack 本編 (stackstack Battle) です。

作者の意図した順序があるのに機械可読になっていなかったため、ポータルは track を持つ唯一の大きな集合 (`advanced-cryptography-2026`、31 問) を既定導線に選んでいた。1 問解いた直後の初学者に大学院レベルの法演算が提示されるのは、学習設計ではなく並び順の副作用だった。

## 章立て

| order | 問題 | 難易度 | 章 |
| --- | --- | --- | --- |
| 10 | `stackstack-onboarding` | d1 | 1. はじめの一歩 |
| 20 | `wix-exposure-audit` | d1 | 2. 壊れ方を知る |
| 30 | `wp-exposed-backup` | d1 | 2. 壊れ方を知る |
| 40 | `sqli-demo` | d2 | 2. 壊れ方を知る |
| 70 | `api-idor-demo` | d2 | 2. 壊れ方を知る |
| 80 | `wp-harden-leaks` | d3 | 3. 運用で直す |
| 90 | `wp-midnight-admin` | d3 | 3. 運用で直す |
| 100 | `stackstack-ship` | d3 | 4. StackStack 本編 |
| 110 | `stackstack-vibe-build` | d3 | 4. StackStack 本編 |
| 120 | `stackstack-safe-exposure` | d3 | 4. StackStack 本編 |
| 130 | `stackstack-secrets` | d3 | 4. StackStack 本編 |
| 140 | `stackstack-defend` | d3 | 4. StackStack 本編 |
| 150 | `stackstack-observability` | d3 | 4. StackStack 本編 |
| 160 | `stackstack-recover` | d3 | 4. StackStack 本編 |
| 170 | `wp2shell-local-lab` | d4 | 5. 本番インシデント |

order 50 / 60 が空いているのは意図的。理由は「既知の断絶」の 1 番目にある。

### ルートの終点は local play の外にある

このルートが目指している **StackStack 本編 (`battles/stackstack`) 自体が AWS 専用**である
(Issue 402)。`local/` を持たないので `make local` では起動せず、参加するには自チームの AWS
アカウントが TenkaCloud に登録されている必要がある。

上の表に入っている `stackstack-*` 8 問は本編と同じ世界観の local play 版で、これらは
コンテナだけで完走できる。**8 問を終えた人が次に踏む一歩は「もう 1 問解く」ではなく「AWS
アカウントを用意する」**であり、ルートはそこで一度性質が変わる。

`battles/stackstack` の instructions は冒頭でそう宣言している。ルートの案内でそれを隠さない
こと — 隠すと、8 問を終えた人がカードを開いて「自チームに deploy されていません」で行き止まる。

## 順序の根拠

**難易度の数値では並べていない。** 本編 8 問はすべて d3 で、数値からは順序が出ない。根拠は問題本文が明示しているストーリー上の前後関係である。

- `stackstack-ship` — 「板は動いた。まだ、運用コンソールの内側だけで」。`onboarding` で動かした板が前提。
- `stackstack-vibe-build` — 「入社 3 日目。昨日ようやく外から見えるところまで持っていった社内掲示板に」。`ship` の翌日。
- `stackstack-safe-exposure` — 「昨日あなたが外から見えるようにした掲示板は、今日から取引先にも配られる」。同じく `ship` の翌日。
- `stackstack-defend` — 「掲示板は無事に開き、部署ごとの『下書き』機能まで載った」。下書きと tenant を導入するのは `safe-exposure`。
- `stackstack-observability` — 「書いたのに後から探せない」。探す対象の検索を足すのは `vibe-build`。
- `stackstack-recover` — 「昨夜のデプロイで本番品質になったはず。投稿に認証を付け、アプリが書いてよい場所を必要なところだけに絞った」。認証は `safe-exposure`、権限の最小化は `defend` / `secrets` の後。

## 既知の断絶

受け入れ条件の要求により、**埋まっていない箇所を埋まったことにせず列挙する**。ここに挙げたものは、既存問題だけでは前の問題までの知識で着手できない。

### 1. XSS と CSRF がルートに含まれない (order 50 / 60 が空席)

`xss-demo` と `csrf-demo` は既に `ipa-web-security` track に属している。`track` は 1 問につき 1 つなので、ルートへ移すと IPA 対応の体系が消える。既存の体系を壊さない判断で残した。

結果として、`stackstack-vibe-build` が「利用者が書いた文字を画面に出すときに、削除ではなくエスケープで扱う理由」を要求するのに、**なぜエスケープが要るのか (= XSS) をルート内で一度も扱っていない**。`sqli-demo` は入力を問い合わせ文へ連結する危険を教えるので方向は近いが、別の閲覧者の権限を奪うという XSS の核心は埋まらない。

対応案は 2 つ。どちらもこの Issue の範囲外。

- ルート専用の XSS / CSRF 問題を新規に作る
- track を複数持てるようにスキーマを拡張する (platform 側の変更)

### 2. デプロイの基礎が手前に無い

`stackstack-ship` は「ビルド済みの成果物が存在することと、それが配られていることが別の事実だと区別できる」ことと stage 単位のデプロイログの読み分けを要求する。直前の `wp-midnight-admin` までは「既にあるサイトを外から調べて是正する」話で、**デプロイパイプラインを扱う問題が一度も出てこない**。

`stackstack-onboarding` は設定とログの 1 周を扱うが、デプロイの段階分けまでは踏み込まない。ここは新規問題が要る。

### 3. 資格情報管理の前提

`stackstack-secrets` は「発行 → 切替 → 失効の順で資格情報を入れ替えられる」ことを要求する。ローテーションという概念そのものは `wp-midnight-admin` の是正案 (資格情報のローテーション) で言及されるが、**手を動かして入れ替える経験は手前に無い**。断絶としては 1 / 2 より小さい。

### 4. 5 章 (本番インシデント) は 1 問しかない

`wp2shell-friday-night-patch` は `local/` を持たず local play で起動できないため、ルートから外した。導線に入れると解けない問題へ誘導することになる (Issue 402)。結果として 5 章は `wp2shell-local-lab` の 1 問だけになる。

`wp2shell-local-lab` 自身が「本番を触る前の予行演習」という位置づけなので、**予行演習だけあって本番が無い**状態になっている。`friday-night-patch` は AWS 専用であることを instructions に明記したので行き止まりではなくなったが、local play だけで一周したい人にとって 5 章が 1 問なのは変わらない。ここは新規問題が要る。

### 5. ルートの途中で、ブラウザだけでは足りなくなる

ルート上の 2 問は**ホスト側のターミナルが要る** (Issue 415)。

- `wp-harden-leaks` (order 80) — `docker compose exec wordpress bash` でサーバに入って直す
- `wp2shell-local-lab` (order 170) — 最初の一手が `docker compose logs`、以降は `curl`

上の「`stackstack-*` 8 問はコンテナだけで完走できる」は 8 問についての記述であって、ルート
全体についてではない。3 章に入った時点で、参加者は手元のターミナルを開くことになる。両問の
instructions には要ることを明記した (`check:problem` の `host terminal disclosed` が、書いて
いない状態を落とす)。

ポータル内蔵ターミナル (`runtime.terminal`) を宣言すればブラウザだけで済む可能性はあるが、
`SCHEMA.json` にそのキーは無く、宣言側は platform の契約になる。カタログ側で閉じられるのは
「黙っていない」ところまでで、ブラウザ完結そのものは Issue 415 に残っている。

## 暗号トラックの位置づけ

`advanced-cryptography-2026` (31 問) は完成度の高い独立した講座であり、消す対象ではない。ただし StackStack を目指す人の既定ルートではないため、既定推薦から外してある。

除外は platform 側 (`apps/participant-portal/src/data/course-track.ts`) の
`TRACKS_EXCLUDED_FROM_DEFAULT_RECOMMENDATION` で宣言する。**到達不能にはしていない** —「講座トラック」画面からは通常どおり見えて始められる。

## platform 側との関係

このルートが既定導線になるには、platform 側の `DEFAULT_RECOMMENDATION_TRACK_PRIORITY` の先頭に `stackstack-route` が入っている必要がある。順序の選択そのものは TenkaCloud 2965 で「明示した優先順で選ぶ」形に直してあり、辞書順には戻らない。

## 関連

- Issue 397 — このルートの起票元
- Issue 402 — AWS 専用問題が local play で行き止まりになる (5 章が 1 問しかない理由)
- TenkaCloud 2965 — 選択が辞書順だった platform 側の欠陥
