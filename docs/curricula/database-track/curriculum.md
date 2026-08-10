# Database Track

Epic #431「Database Track」の起票元。**未経験者が local mode の Drill から始め、
Challenge → Battle (#430「DB が遅いらしい」) → Polyglot Battle へ登る学習体系**の
うち、Phase 1 (PostgreSQL vertical slice) を対象にする。

`track.id` は `database-track`。`index.json` から機械可読で、ポータルの「次にや
ること」と「講座トラック」画面はこの順序を読む (`docs/curricula/stackstack-route/curriculum.md`
が先例で、本ドキュメントもその形式に倣う)。

## この PR で実装した範囲

Phase 1 の全体設計と依存関係を本ドキュメントで先に確定した。実装は複数 PR に分
けて進めており、最初の PR で **Drill A1・A2**、この PR (stacked #2) で **Drill
A3・A4** を実装した。残りは「計画」であって「実装済み」ではない。実装状況は各
行の先頭に明記する。

| 状態 | order | 問題 ID | 章 | 前提とする Drill | 学ぶこと |
| --- | --- | --- | --- | --- | --- |
| ✅ 実装済み | 10 | `db-a1-table-primary-key` | 1. Storage Foundations | (なし・入口) | Table / Row / Primary Key ── 制約が無ければ物理的に重複行を許すこと |
| ✅ 実装済み | 20 | `db-a2-index-tradeoff` | 1. Storage Foundations | A1 | Index の read/write trade-off ── Seq Scan vs Index Scan、EXPLAIN の読み方 |
| ✅ 実装済み | 30 | `db-a3-query-plan` | 1. Storage Foundations | A2 | Query Plan ── planner が必ず index を選ぶわけではないこと (選択性、統計、コスト推定) |
| ✅ 実装済み | 40 | `db-a4-transaction` | 2. Transactions & Concurrency | A1 | Transaction ── BEGIN/COMMIT/ROLLBACK、原子性を壊す操作の観察 |
| 🧭 計画 | 50 | `db-a6-lock` (仮 ID) | 2. Transactions & Concurrency | A4 | Lock ── 行ロック・デッドロックを 2 セッションで再現する |
| 🧭 計画 | 60 | `db-a7-mvcc` (仮 ID) | 2. Transactions & Concurrency | A4, A6 | MVCC ── 複数トランザクションから見える行バージョンの違い |
| 🧭 計画 | 70 | `db-a8-delete-vacuum` (仮 ID) | 2. Transactions & Concurrency | A7 | DELETE / VACUUM ── MVCC が生む dead tuple と VACUUM の役割 |
| 🧭 計画 | 80 | `db-a10-primary-replica` (仮 ID) | 3. Scaling & Topology | A1 | Primary / Replica ── 物理レプリケーションの構成を自分で組む |
| 🧭 計画 | 90 | `db-a11-replication-lag` (仮 ID) | 3. Scaling & Topology | A10 | Replication Lag ── 遅延を発生させ、観測し、原因を説明する |
| 🧭 計画 | 100 | `db-a12-partition` (仮 ID) | 3. Scaling & Topology | A2, A8 | Partition ── テーブルパーティショニングと prune の効果測定 |
| 🧭 計画 | 110 | Challenge 1 (仮称: slow query) | 4. Challenges | A2, A3 | 未知のスロークエリを EXPLAIN で特定し、根本対策する |
| 🧭 計画 | 120 | Challenge 2 (仮称: blocked transaction) | 4. Challenges | A6, A7 | ブロックしているトランザクションを `pg_locks` / `pg_stat_activity` から特定し、解消する |
| 🧭 計画 (別 Issue #430) | 130 | Battle #430「DB が遅いらしい」 | 5. Battle | 4章の Challenge 全て | 上記全ドリルを前提にした、時間制限つきの実戦形式 |

order 50 (A6) 以降は**「まだ実行できません」ではなく「まだ書いていません」**。
runtime は A1〜A4 と同じ docker/compose (postgres:16 系) で成立する見込みで、
runtime そのものが動かないわけではない。A6・A7 は 2 つの transaction を同時に
操作させる必要がある最初の Drill で、A4 が Portal 内蔵ターミナル 1 つの中から
psql の `\!` で 2 本目の psql プロセスを起動する形で「2 セッションの同時操作」
を先に解決しているため、その手法を踏襲できる見込みが立った (後述の「既知の断
絶」参照)。

## 順序の根拠 (prerequisite 依存関係であって difficulty / ID 辞書順ではない)

Epic の要求どおり、順序は「A1, A2, A3, A4, ...」という ID の辞書順や単純な難易
度の数値ではなく、**前の Drill で観測した事実が無いと次の Drill の核心が説明で
きない**という依存関係で決めている。

- **A1 → A2**: A2 は「index が無いと Seq Scan になる」ことを EXPLAIN で確認させ
  るが、その前提として「テーブルの行が何によって一意に識別されるか」(= primary
  key の意味) を A1 で先に体感していないと、`order_number` という業務キーを
  「なぜ検索対象にするのか」が飲み込めない。
- **A2 → A3**: A3 は「planner は必ず index を選ぶわけではない」ことを見せる。
  A2 で「index を作れば速くなる」という単純化した理解を作った直後だからこそ、
  A3 の「選択性が低いと Seq Scan のままの方が実際に速いことがある」という反例
  が効く。A2 を経ていない参加者に A3 だけを見せても、比較対象が無く「へえ」で
  終わる。
- **A1 → A4**: Transaction は「複数の操作をまとめて 1 単位として扱う」ことが主
  題。行 (row) という最小単位の概念を先に固めていないと、「複数行にまたがる操
  作の原子性」を切り出して説明できない。
- **A4 → A6 → A7 (計画)**: Lock は「同時に 2 つのトランザクションが同じ行を触
  ろうとしたら何が起きるか」を Transaction の続きとして扱う。MVCC は、その Lock
  の観察 (「読み取りはブロックされないのに書き込みはブロックされる」) を経て初
  めて「なぜ読み取りはブロックされないのか」という MVCC の核心 (行バージョニン
  グ) に自然につながる。
- **A7 → A8 (計画)**: DELETE / VACUUM は MVCC が生む dead tuple (削除されても
  古いバージョンとして残る行) の後始末の話なので、MVCC を理解していない状態で
  VACUUM だけを教えると「ゴミ掃除コマンド」以上の意味を持たない。
- **A1 → A10 → A11 (計画)**: Primary/Replica は「1 つのテーブルの状態をどう複
  製するか」という主題で、複製対象である「テーブルの行」の概念さえあれば A2〜
  A8 を経由しなくても成立する。Replication Lag は Primary/Replica の構成が既に
  あることが前提。
- **A2, A8 → A12 (計画)**: Partition は「大きな 1 つのテーブルを分割して読み書
  きの効率を上げる」話で、Index による絞り込み (A2) と VACUUM/DELETE の運用コ
  スト (A8) の両方を知っていないと、「なぜパーティションが有効か」の半分しか説
  明できない。
- **Challenge 1 (計画)**: A2 (index) と A3 (query plan) が無いと、未知のスロー
  クエリを自力で EXPLAIN から特定する土台が無い。
- **Challenge 2 (計画)**: A6 (lock) と A7 (MVCC) が無いと、`pg_locks` /
  `pg_stat_activity` から「何がブロックしているトランザクションを止めているか」
  を読み解けない。
- **Battle #430 (計画、別 Issue)**: 4 章の Challenge 2 問を前提にした実戦形式。
  Drill だけを終えた状態で Battle に出すと、時間制限の中で使う道具 (EXPLAIN、
  pg_locks 等) に触れたことが無いまま競技に投げ出すことになる。

## 設計原則との対応 (Epic より)

- **「答えを読むだけ」にしない**: A1〜A4 とも、操作前後で観測値が変わる体験に
  なっている。A1 は「重複を止める制約が無い状態」→「重複を止める PRIMARY KEY
  がある状態」を同じ操作 (`insert` の重複) で対比させる。A2 は
  `EXPLAIN (ANALYZE, BUFFERS)` の Node Type とバッファ数を index 追加前後で対比
  させ、INSERT 側の変化も (採点対象外ではあるが) instructions で明示的に手を動
  かして体感させる。A3 は同じ index つきの列に対する 2 つのクエリ (希少値/大多
  数値) を `ANALYZE` の前後で対比させ、row estimate が統計に依存することを見せ
  る。A4 は同じ「失敗する送金」を transaction 無し/有りの両方で実行させ、
  ROLLBACK が原子性を守る様子を対比させ、Portal ターミナル 1 つの中から psql の
  `\!` で未 commit の不可視性まで自分の目で確認させる。
- **採点は外部状態で行う**: 4 問とも `scoring.kind: "multi-verify"` で、提出テ
  キストは一切読まれない。checkpoint は毎回、コンテナ内の実 Postgres へ
  `pg_index` / `pg_indexes` への問い合わせ、実際の `EXPLAIN` 実行、
  `pg_stat_user_tables` の統計、`xmin` システム列などで判定する。答えの
  hard-code では核心 checkpoint を通過できない (詳細は各問題の README の
  「How scoring works」節)。A4 の `updates-committed-atomically` は、2 つの
  UPDATE を別々の autocommit 文で実行して「数字だけ正しい」状態に到達しても
  `xmin` が一致しないため通らない設計にした。
- **学習順は prerequisite 依存関係で決める**: 上述のとおり。`track.order` は
  10 刻みで、この依存関係の順に並んでいる。
- **runtime fidelity を偽装しない**: 実 PostgreSQL 16 系公式 image
  (`postgres:16-alpine`) をそのまま使う。participant-visible な endpoint は
  loopback のみ、external credential / external network は不要、
  `docker compose down -v` で完全に再現可能な seed 済み初期状態に戻る。A2 の
  40 万行・A3 の 30 万行 seed もラップトップで数秒 (実測、後述の Verification
  節参照) で生成できる規模に抑えている。
- **bilingual**: metadata.json の全 participant-visible field (name /
  shortDescription / instructions / description / writeup / learningGoals /
  checks[].label / checks[].hints) が ja (top-level) + `i18n.en` の両方を持つ。
- **hidden answer / verifier material を参加者へ渡さない**: A1 に「答えの文字
  列」は存在しない (flag が無い設計)。A2 の「index 追加前のバッファ数
  (baseline)」は `grading` schema に置かれ、`participant` role には
  `USAGE`/`CREATE` すら与えていない ── 読み出しも改ざんもできない。A3・A4 は
  目標値 (対象クエリ、送金額) 自体が instructions で公開されている値であり、
  隠す必要が無いため `grading` schema を持たない。

## runtime 選定の根拠

`docs/authoring/runtime-and-style.md` の判断ガイドに沿って `docker/compose` を
選んだ。学習目標が Postgres エンジン内部の意味論 (物理ストレージと論理制約の関
係、クエリプランナの選択、バッファ I/O) に依存し、AWS 固有の control plane や
managed service の意味論には依存しないため。「AWS っぽい名前を付けるだけ」の問
題にしていない。

A1〜A4 とも `runtime.terminal` を宣言し、Portal 内蔵ターミナルから `psql` に直
接触れる形にした (ホスト側に何もインストールしなくてよい)。`docker compose exec`
のようなホストコマンドを instructions 本文には書いていない (書くと
`check:problem` の `host terminal disclosed` チェックが「ホスト側のターミナル
が必要です」の明記を要求するため。README には fallback として明記している)。

## 採点構造 (machine-readable)

各問題の `metadata.json` は次を宣言する。

- `track`: `{ "id": "database-track", "order": <10 刻み>, "chapter": "<章名>" }`
- `runtime`: `{ "provider": "docker", "engine": "compose", ... "terminal": { "service": "<compose service名>" } }`
- `scoring`: `{ "kind": "multi-verify", "checks": [...] }` ── 満点は難易度ティ
  ア標準 (`SCORING.md`)。A1 は difficulty 1 (Easy, 100pt)、A2・A3・A4 は
  difficulty 2 (Easy, 100pt)。

生成される `index.json` がポータルの「講座トラック」画面と「次にやること」導線
の正本になる (`bun run reindex` で再生成、手編集禁止)。

## 既知の断絶

受け入れ条件の要求により、**埋まっていない箇所を埋まったことにせず列挙する**。

### 1. Phase 1 の 10 問中 4 問しか実装していない

A6〜A12 (10 問中 6 問、A5・A9 は Epic 側の番号採番自体に元から存在しない ──
stackstack-route の order 50/60 の空席と同様、意図的な欠番であって本 PR のミス
ではない) と Challenge 2 問、Battle への接続はこの PR の範囲外。それぞれの
runtime は A1〜A4 と同じ docker/compose (postgres:16 系) で成立する見込みだが、
実装するまでは見込みでしかない。特に Lock / MVCC の Drill (A6, A7) は 2 つの
transaction を同時に操作させる必要がある ── A4 は Portal 内蔵ターミナル 1 つの
中から psql の `\!` で 2 本目の psql プロセスを一時的に起動する形でこれを解決
した (未 commit の不可視性を見せるため)。A6/A7 で必要になる「両方の transaction
を同時に開いたまま交互に操作する」はこれより一段複雑で (`\!` は片方の
transaction を一時停止させるだけで、両方を同時に進行させることはできない)、
Portal 内蔵ターミナルが複数タブ/複数セッションをどう扱うかは、この 2 問を実装
する時点で改めて確認が要る。

### 2. Docker image のビルド・起動は実 Docker で未検証 (セッション固有の制約)

A1〜A4 いずれの実装セッションでも、Docker daemon 自体は起動できたが、
`postgres:16-alpine` / `node:22-alpine` を含む Docker Hub からの image pull が
ネットワークポリシーでブロックされていた (`production.cloudfront.docker.com`
への CONNECT が 403)。そのため **配布する Docker image そのものをビルド・起動
しての検証はできていない**。

代わりに、apt でインストールした実 PostgreSQL 16 (`postgresql-16`, Ubuntu
noble) をこのマシン上で直接起動し、`local/db/schema.sql` → `local/db/seed.sql`
→ `local/app/server.mjs` (`postgres` JS driver 経由) → 参加者役の `psql` 操作
→ `/verify` への実 HTTP リクエストという経路を、**A1〜A4 それぞれについて before
(未解決) → after (解決) の両状態で** 実行し、3 checkpoint すべてが正しく
false → true に反転すること、grader のロールバック系プローブ (A1 の重複
insert 試行、A2/A3 は読み取り専用、A4 は残高と `xmin` の読み取り専用) が参加者
データを一切汚さないことを確認した。A4 はさらに、参加者役の `psql` から
`\!` で 2 本目の psql を起動する未 commit 不可視性のデモ手順そのものを実際に動
かして確認した。これは `postgres:16-alpine` と同じ PostgreSQL 16 系エンジンだ
が、**配布物そのものではない**。Docker が使える環境での
`make local PROBLEM=db-a1-table-primary-key` 等 4 問それぞれの最終確認は未実施
であり、one-time verification として残る (詳細は PR 本文の Validation 節)。

### 3. platform 側 (TenkaCloud リポジトリ) の導線設定は未確認

`stackstack-route` の先例と同じ理由で、`database-track` がポータルの既定推薦
に出るには platform 側 `DEFAULT_RECOMMENDATION_TRACK_PRIORITY` にこの track.id
が入っている必要がある。本 PR は TenkaCloudChallenge リポジトリのみのスコープ
であり、platform 側の変更は含まない。

同様に `runtime.terminal` は SCHEMA.json の契約としては満たしているが、実際の
Portal がこの契約をどう描画するか (embedded terminal panel の UX) は platform
側の実装に依存する。`wp-harden-leaks` が同じ宣言を先に使っているため、契約自
体は実績があるとみなしている。

### 4. Challenge 2 問と Battle #430 の具体的な内容は未確定

curriculum.md 上は「slow query」「blocked transaction」という仮称のみで、
metadata・runtime・scoring は何も決まっていない。Battle #430 は別 Issue であ
り、本 PR はその接続点 (Phase 1 の Drill が Battle の前提知識になっていること)
を上の依存関係表で記述したのみで、Battle 側の実装には一切触れていない。

## 関連

- Issue #431 — このトラックの起票元 (Epic)
- Issue #430 — 接続先の Battle「DB が遅いらしい」
- `docs/curricula/stackstack-route/curriculum.md` — 本ドキュメントが形式として
  倣った先例 (「既知の断絶」を隠さず列挙するスタイル)
- `docs/authoring/runtime-and-style.md` — runtime 選定の判断ガイド
- `SCORING.md` — 難易度ティアと得点配分の規定
