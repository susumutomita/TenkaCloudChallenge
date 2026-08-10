# Database Track

Epic #431「Database Track」の起票元。**未経験者が local mode の Drill から始め、
Challenge → Battle (#430「DB が遅いらしい」) → Polyglot Battle へ登る学習体系**の
うち、Phase 1 (PostgreSQL vertical slice) を対象にする。

`track.id` は `database-track`。`index.json` から機械可読で、ポータルの「次にや
ること」と「講座トラック」画面はこの順序を読む (`docs/curricula/stackstack-route/curriculum.md`
が先例で、本ドキュメントもその形式に倣う)。

## この PR で実装した範囲

Phase 1 の全体設計と依存関係を本ドキュメントで先に確定した。実装は複数 PR に分
けて進めており、最初の PR で **Drill A1・A2**、stacked #2 で **Drill A3・A4**、
stacked #3 で **Drill A6・A7**、stacked #4 で **Drill A8・A12**、この PR
(stacked #5) で **Drill A10・A11** を実装した。残りは「計画」であって「実装済
み」ではない。実装状況は各行の先頭に明記する。

| 状態 | order | 問題 ID | 章 | 前提とする Drill | 学ぶこと |
| --- | --- | --- | --- | --- | --- |
| ✅ 実装済み | 10 | `db-a1-table-primary-key` | 1. Storage Foundations | (なし・入口) | Table / Row / Primary Key ── 制約が無ければ物理的に重複行を許すこと |
| ✅ 実装済み | 20 | `db-a2-index-tradeoff` | 1. Storage Foundations | A1 | Index の read/write trade-off ── Seq Scan vs Index Scan、EXPLAIN の読み方 |
| ✅ 実装済み | 30 | `db-a3-query-plan` | 1. Storage Foundations | A2 | Query Plan ── planner が必ず index を選ぶわけではないこと (選択性、統計、コスト推定) |
| ✅ 実装済み | 40 | `db-a4-transaction` | 2. Transactions & Concurrency | A1 | Transaction ── BEGIN/COMMIT/ROLLBACK、原子性を壊す操作の観察 |
| ✅ 実装済み | 50 | `db-a6-lock` | 2. Transactions & Concurrency | A4 | Lock ── 同じ行への書き込み同士が行ロックで待たされる様子を 2 セッションで再現し、pg_locks/pg_stat_activity で blocker を特定する |
| ✅ 実装済み | 60 | `db-a7-mvcc` | 2. Transactions & Concurrency | A4, A6 | MVCC ── 読み取りが書き込みに待たされない理由 (行バージョニング) を xmin/xmax で観察し、長時間 transaction が VACUUM の dead tuple 回収を妨げる様子を確認する |
| ✅ 実装済み | 70 | `db-a8-delete-vacuum` | 2. Transactions & Concurrency | A7 | DELETE / VACUUM ── 大量 DELETE 直後は disk が縮まず n_dead_tup が増えること、手動 VACUUM で dead tuple は回収されるがファイルサイズ自体は縮まないこと (VACUUM FULL との対比) を確認する |
| ✅ 実装済み | 80 | `db-a10-primary-replica` | 3. Scaling & Topology | A1 | Primary / Replica ── primary + streaming replica の 2 ノード構成 (結線は自動) で、書き込みが replica へ継続的に追従することを実測する |
| ✅ 実装済み | 90 | `db-a11-replication-lag` | 3. Scaling & Topology | A10 | Replication Lag ── recovery_min_apply_delay で replica の apply を意図的に絞り、lag を発生させてから解消する |
| ✅ 実装済み | 100 | `db-a12-partition` | 3. Scaling & Topology | A2, A8 | Partition ── 同じ規模の古いデータを row-level DELETE で消す場合と DETACH PARTITION (+ DROP TABLE) で消す場合の作業量の違いを実測比較する |
| 🧭 計画 | 110 | Challenge 1 (仮称: slow query) | 4. Challenges | A2, A3 | 未知のスロークエリを EXPLAIN で特定し、根本対策する |
| 🧭 計画 | 120 | Challenge 2 (仮称: blocked transaction) | 4. Challenges | A6, A7 | ブロックしているトランザクションを `pg_locks` / `pg_stat_activity` から特定し、解消する |
| 🧭 計画 (別 Issue #430) | 130 | Battle #430「DB が遅いらしい」 | 5. Battle | 4章の Challenge 全て | 上記全ドリルを前提にした、時間制限つきの実戦形式 |

order 110 (Challenge 1) 以降は**「まだ実行できません」ではなく「まだ書いていま
せん」**。runtime は A1〜A8・A10〜A12 と同じ docker/compose (postgres:16 系) で
成立する見込みで、runtime そのものが動かないわけではない。A6・A7 は「2 つの
transaction を同時に操作する」という要求を解決した最初の Drill、A10・A11 は
「1 コンテナでは表現できない、2 ノードの物理トポロジー」という要求を解決した
最初の Drill で、それぞれの具体的な手法は後述の「既知の断絶」1 節に記録した。

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
- **A4 → A6 → A7**: Lock は「同時に 2 つのトランザクションが同じ行を触ろうと
  したら何が起きるか」を Transaction の続きとして扱う。MVCC は、その Lock の
  観察 (「書き込み同士はブロックされる」) を経て初めて「なぜ読み取りはブロッ
  クされないのか」という MVCC の核心 (行バージョニング) との対比が効く ── A7
  の最初の一手は A6 の逆から始まる (読み取りは待たされないことを見せる)。
- **A7 → A8**: DELETE / VACUUM は MVCC が生む dead tuple (削除されても古いバー
  ジョンとして残る行) の後始末の話なので、MVCC を理解していない状態で VACUUM
  だけを教えると「ゴミ掃除コマンド」以上の意味を持たない。
- **A1 → A10 → A11**: Primary/Replica は「1 つのテーブルの状態をどう複製する
  か」という主題で、複製対象である「テーブルの行」の概念さえあれば A2〜A8 を
  経由しなくても成立する。Replication Lag は Primary/Replica の構成が既にある
  ことが前提 ── A11 は A10 と同じ 2 ノード topology を、独立にもう一度セット
  アップして使う (コンテナは共有しない)。
- **A2, A8 → A12**: Partition は「大きな 1 つのテーブルを分割して読み書きの効
  率を上げる」話で、Index による絞り込み (A2) と DELETE の運用コスト (A8、行数
  に比例して重くなる) の両方を知っていないと、「DETACH PARTITION がなぜ行数に
  依存しないほぼ定数時間で終わるのか」という対比の片方しか説明できない。
- **Challenge 1 (計画)**: A2 (index) と A3 (query plan) が無いと、未知のスロー
  クエリを自力で EXPLAIN から特定する土台が無い。
- **Challenge 2 (計画)**: A6 (lock) と A7 (MVCC) が無いと、`pg_locks` /
  `pg_stat_activity` から「何がブロックしているトランザクションを止めているか」
  を読み解けない。
- **Battle #430 (計画、別 Issue)**: 4 章の Challenge 2 問を前提にした実戦形式。
  Drill だけを終えた状態で Battle に出すと、時間制限の中で使う道具 (EXPLAIN、
  pg_locks 等) に触れたことが無いまま競技に投げ出すことになる。

## 設計原則との対応 (Epic より)

- **「答えを読むだけ」にしない**: A1〜A4・A6〜A8・A10〜A12 とも、操作前後で観測
  値が変わる体験になっている。A1 は「重複を止める制約が無い状態」→「重複を止める
  PRIMARY KEY がある状態」を同じ操作 (`insert` の重複) で対比させる。A2 は
  `EXPLAIN (ANALYZE, BUFFERS)` の Node Type とバッファ数を index 追加前後で対比
  させ、INSERT 側の変化も (採点対象外ではあるが) instructions で明示的に手を動
  かして体感させる。A3 は同じ index つきの列に対する 2 つのクエリ (希少値/大多
  数値) を `ANALYZE` の前後で対比させ、row estimate が統計に依存することを見せ
  る。A4 は同じ「失敗する送金」を transaction 無し/有りの両方で実行させ、
  ROLLBACK が原子性を守る様子を対比させ、Portal ターミナル 1 つの中から psql の
  `\!` で未 commit の不可視性まで自分の目で確認させる。A6 は blocker (`begin`
  したまま放置) と waiter (`\! ... &` でバックグラウンド化した 2 本目の psql)
  を対比させ、`pg_stat_activity`/`pg_blocking_pids()` で実際に待たされている
  様子を観察させる。A7 は A6 と対称の構造で、書き込み中の行への読み取りが一切
  ブロックされないことをまず見せ (A6 との対比)、続けて `repeatable read` の長
  時間 transaction が開いている間だけ `VACUUM` が dead tuple を回収できないこ
  とを、閉じる前後で対比させる。A8 は 30 万行の DELETE 直後に table size が縮
  まないこと・`n_dead_tup` が急増することを見せ、手動 VACUUM 後は dead tuple
  が回収されるのに table size 自体は変わらないこと (VACUUM FULL との対比) ま
  で 3 段階で対比させる。A12 は同じ約 2 万行規模の削除を通常の DELETE と
  DETACH PARTITION の両方で実際に実行させ、`\timing` の所要時間を自分の目で
  比較させる ── 「partition を使うべき」という結論は先に教えない。A10 は
  primary への書き込みが replica へ届くことを 1 回ではなく時間差のある 2 回
  (`wave-1`→確認→`wave-2`→確認) で対比させる ── 1 回だけでは「コピー」と
  「追従」を区別できないという、このドリルの核心そのものを体験させる構造。A11
  は `recovery_min_apply_delay` を上げてから書き込んで `replay_lag` が伸びる
  様子、下げてからもう一度書き込んで縮む様子を対比させ、`replay_lag` が常時
  カウントアップするタイマーではなく feedback を受けた瞬間だけ更新される値だ
  という、実機で確認した挙動をそのまま体験させる。
- **採点は外部状態で行う**: 10 問とも `scoring.kind: "multi-verify"` で、提出テ
  キストは一切読まれない。checkpoint は毎回、コンテナ内の実 Postgres へ
  `pg_index` / `pg_indexes` への問い合わせ、実際の `EXPLAIN` 実行、
  `pg_stat_user_tables` の統計、`xmin` システム列、`pg_xact_commit_timestamp()`、
  `pg_stat_activity.backend_xmin`、`pg_class.relispartition`/`pg_inherits`、
  `pg_stat_replication`/`pg_stat_wal_receiver` の LSN・lag などで判定する。答え
  の hard-code では核心 checkpoint を通過できない (詳細は各問題の README の
  「How scoring works」節)。
  A4 の `updates-committed-atomically` は、2 つの UPDATE を別々の autocommit 文
  で実行して「数字だけ正しい」状態に到達しても `xmin` が一致しないため通らない
  設計にした。A6 の `row-lock-wait-observed` は、`audit.lock_wait_log` (trigger
  だけが書く監査 log) の `pg_xact_commit_timestamp()` を使い、「別 backend の
  transaction が、こちらの UPDATE 文がまだ実行中の間に本当に commit した」とい
  う時間的重なりでのみ通す ── 経過時間の閾値だけだと自分の文に `pg_sleep()` を
  仕込むだけで偽装できてしまうため、単純な閾値ではなくこの重なりを見る設計にし
  た。A7 の `long-transaction-blocked-cleanup-observed` は、`audit.churn_log` の
  `pg_stat_activity.backend_xmin` が非 null (= 実際に snapshot を保持している)
  な transaction が開いている間の churn だけを数える ── 単なる `begin;` は
  VACUUM を一切妨げないことをホストの実 Postgres 16 で確認した上での設計。A8
  の `bulk-delete-observed` は、`audit.delete_log` (statement-level trigger +
  transition table が書く監査 log) の削除行数合計と、`pg_stat_user_tables`
  の累積カウンタ `n_tup_del` (VACUUM でもリセットされない) の 2 系統で独立に
  「本当に大量 DELETE が起きたか」を突き合わせる ── 参加者が未使用のテーブル
  に `VACUUM;` を叩くだけで `dead-tuples-reclaimed` が素通りしてしまう near-
  miss を、この二重チェックで塞ぐ設計にした。A12 の
  `old-month-deleted-via-delete` は、2024-01 の partition が「attach された
  まま」であることを `pg_class.relispartition` で要求する ── DETACH は必ず
  この値を false にするため、「attach されたまま行数 0」は本物の row-level
  DELETE でしか到達できない (2024-02 の DETACH を 2024-01 に流用する近道を
  塞ぐ)。A10 の `writes-follow-to-replica` は、primary と replica 両方の行数
  一致だけで判定する ── 一見 A1〜A8/A12 より単純だが、実機の Postgres 16 で
  確認した「recovery mode 中の standby は superuser を含む全 role の通常 DML
  を拒否する」という事実により、replica 側の一致は本物の WAL replay でしか
  説明できない。そのため他ドリルのような trigger 監査 `audit` schema が不要
  になった ── replica の read-only 性質そのものが anti-cheat になっている
  設計。A11 の `lag-resolved` は、直近の低い replay_lag だけでなく、それより
  前に `lag-induced` 相当の spike が記録されていることも要求する ── そうしな
  いと「一度も lag を発生させていない (最初からずっと低いだけ)」状態が
  trivially 通ってしまうため。この spike/低下の履歴は `audit.lag_samples`
  (participant が書き込めず、primary の Node app が約 1 秒おきに書く記録) に
  残る ── trigger の代わりにタイマーが埋める、A6〜A8 と同じ「診断結果の自己
  申告を避ける」という設計原則の延長。
- **学習順は prerequisite 依存関係で決める**: 上述のとおり。`track.order` は
  10 刻みで、この依存関係の順に並んでいる。
- **runtime fidelity を偽装しない**: 実 PostgreSQL 16 系公式 image
  (`postgres:16-alpine`) をそのまま使う。participant-visible な endpoint は
  loopback のみ、external credential / external network は不要、
  `docker compose down -v` で完全に再現可能な seed 済み初期状態に戻る。A2 の
  40 万行・A3 の 30 万行・A8 の 40 万行 seed もラップトップで数秒 (実測、後述
  の Verification 節参照) で生成できる規模に抑えている。A12 の seed は意図的
  に 12 万行 (A8 より小規模) ── このドリルの主題は大量データの生成コストでは
  なく、削除の「単位」による作業量の違いなので、差が測定できれば十分であり、
  A8 と同じ規模にする理由が無い。A10・A11 はこのリポジトリで初めて 2 コンテナ
  (`primary`/`replica`) の docker-compose 構成を使う ── 結線は `pg_basebackup
  -R` (standby.signal・primary_conninfo・primary_slot_name を自動生成) と物理
  replication slot によるもので、シミュレーションではなく本物の PostgreSQL 16
  streaming replication。実機検証で `pg_basebackup` が次の自動 checkpoint 待ち
  で長時間停止しうる罠を発見し (`--checkpoint=fast` が必須)、それも含めて
  entrypoint に反映した (詳細は「既知の断絶」1 節)。
- **bilingual**: metadata.json の全 participant-visible field (name /
  shortDescription / instructions / description / writeup / learningGoals /
  checks[].label / checks[].hints) が ja (top-level) + `i18n.en` の両方を持つ。
- **hidden answer / verifier material を参加者へ渡さない**: A1 に「答えの文字
  列」は存在しない (flag が無い設計)。A2 の「index 追加前のバッファ数
  (baseline)」は `grading` schema に置かれ、`participant` role には
  `USAGE`/`CREATE` すら与えていない ── 読み出しも改ざんもできない。A3・A4 は
  目標値 (対象クエリ、送金額) 自体が instructions で公開されている値であり、
  隠す必要が無いため `grading` schema を持たない。A6・A7・A8 は隠す値こそ無い
  が (期待する在庫数・チケット数・retention cutoff は instructions がそのまま
  伝えている)、代わりに「参加者が本当に手順を踏んだか」を証明する `audit`
  schema (trigger だけが書き込み、`participant` は SELECT しかできない) を持
  つ ── A6 の `audit.lock_wait_log`、A7 の `audit.churn_log`、A8 の
  `audit.delete_log` がそれで、どちらも「参加者が診断クエリの結果を専用の回答
  テーブルへ INSERT する」設計は意図的に避けている (それは自己申告と同じで、
  任意の値を打ち込めてしまうため)。A12 は `audit` schema を持たない ──
  `pg_class.relispartition`/`pg_inherits` という、Postgres 自身のカタログが
  管理し、どんな DML 権限でも書き換えられない事実だけで「DETACH という手段を
  正しく使ったか」を判定できるため、trigger による監査 log を別途用意する必
  要が無かった。A10 も `audit` schema を持たない ── 隠す値も無く (書き込む
  marker の値は instructions がそのまま公開している)、replica の recovery
  mode という Postgres 自身の性質そのものが「参加者は replica へ直接書き込め
  ない」ことを保証するため、追加の監査機構が要らない。A11 は `audit` schema
  (`audit.lag_samples`) を持つが、書き込み手は trigger ではなく primary の
  Node app のタイマー ── `pg_stat_replication.replay_lag` という「テーブルで
  はなくシステムビューの値」が対象なので、DML を hook する trigger という手段
  自体が使えない。参加者には `SELECT` しか与えず、この点は A6〜A8 と同じ設計
  思想 (自己申告を避ける) の延長。A11 で `participant` に唯一許可した書き込み
  権限は `recovery_min_apply_delay` という 1 個の GUC のみ (PostgreSQL 15+ の
  `GRANT ... ON PARAMETER` で厳密にスコープ、実機の Postgres 16 で他の GUC は
  "permission denied" になることを確認済み) ── これはこのドリルの正解の手段
  そのものなので隠す対象ではなく、逆に「これ以外は一切変更できない」ことが
  least privilege の担保になっている。

## runtime 選定の根拠

`docs/authoring/runtime-and-style.md` の判断ガイドに沿って `docker/compose` を
選んだ。学習目標が Postgres エンジン内部の意味論 (物理ストレージと論理制約の関
係、クエリプランナの選択、バッファ I/O) に依存し、AWS 固有の control plane や
managed service の意味論には依存しないため。「AWS っぽい名前を付けるだけ」の問
題にしていない。

A1〜A4・A6〜A8・A10〜A12 とも `runtime.terminal` を宣言し、Portal 内蔵ターミナ
ルから `psql` に直接触れる形にした (ホスト側に何もインストールしなくてよい)。
`docker compose exec` のようなホストコマンドを instructions 本文には書いてい
ない (書くと `check:problem` の `host terminal disclosed` チェックが「ホスト
側のターミナルが必要です」の明記を要求するため。README には fallback として
明記している)。

A6・A7 は「2 つの transaction を同時に操作する」という、A4 までには無かった
要求がある。1 つの Portal ターミナルの中から psql の `\!` で 2 本目の psql プ
ロセスを起動する A4 の技法をそのまま踏襲しつつ、2 問で異なる形に発展させた
(詳細は「既知の断絶」1 節)。

A10・A11 は「1 コンテナでは表現できない」という、これまでの Drill には無かっ
た要求がある ── 複製の主題は 2 台目のノードが存在しない限り成立しない。
`runtime.terminal.service` は compose service 名 `primary` (SCHEMA.json の制約
どおり `target: participant` build の 1 service のみ) を指し、もう 1 台の
`replica` へは同じターミナルから `psql -h replica` で compose のサービス名解
決を使って直接つなぐ ── Portal 側に複数タブ/複数コンテナへの terminal 機能を
要求しない、既存の `runtime.terminal` 契約のままで足りる設計にした (詳細は
「既知の断絶」1 節)。

## 採点構造 (machine-readable)

各問題の `metadata.json` は次を宣言する。

- `track`: `{ "id": "database-track", "order": <10 刻み>, "chapter": "<章名>" }`
- `runtime`: `{ "provider": "docker", "engine": "compose", ... "terminal": { "service": "<compose service名>" } }`
- `scoring`: `{ "kind": "multi-verify", "checks": [...] }` ── 満点は難易度ティ
  ア標準 (`SCORING.md`)。A1 は difficulty 1 (Easy, 100pt)、A2・A3・A4・A6・A7・
  A8・A10・A11・A12 は difficulty 2 (Easy, 100pt)。

生成される `index.json` がポータルの「講座トラック」画面と「次にやること」導線
の正本になる (`bun run reindex` で再生成、手編集禁止)。

## 既知の断絶

受け入れ条件の要求により、**埋まっていない箇所を埋まったことにせず列挙する**。

### 1. Phase 1 の Drill 10 問中 10 問を実装、残るのは Challenge 2 問と Battle

A5・A9 は Epic 側の番号採番自体に元から存在しない (stackstack-route の order
50/60 の空席と同様、意図的な欠番であって欠落ではない) ため、Drill は実質 10 問
(A1〜A4, A6〜A8, A10〜A12) 全てが実装済みになった。Challenge 2 問 (order 110・
120) と Battle #430 への接続はこの PR の範囲外のまま (4 節)。

A6・A7 (stacked #3) で「2 つの transaction を同時に操作する」という、A4 まで
には無かった要求をどう解決したかを記録しておく。A4 は Portal 内蔵ターミナル 1
つの中から psql の `\!` で 2 本目の psql プロセスを一時的に起動する形でこれを
解決したが、`\!` はデフォルトで前景実行 (呼び出し元の psql がその完了を待つ)
なので、A4 の「2 本目で SELECT を 1 回打つだけ」には十分でも、A6/A7 が要求す
る「両方の transaction を同時に開いたまま」には足りなかった。2 問で解決の形が
分かれた。

- **A6 (lock)**: waiter 側の書き込みが blocker の行ロックで実際にブロックさ
  れる必要がある ── `\!` を前景のまま使うと、waiter 側の待ちがそのまま呼び出
  し元 (blocker 側) のターミナルごと固まらせてしまい、blocker 自身を操作でき
  なくなる。解決は `\! ... &` でシェルジョブをバックグラウンド化すること ──
  `\!` 自体はすぐ返り、blocker 側のセッションは開いたまま操作を続けられる。
  Portal 内蔵ターミナルが複数タブを持つ必要は無かった。
- **A7 (MVCC)**: 長時間 transaction (`repeatable read`) はどの行もロックしな
  いので、別セッションからの churn はそもそもブロックされない ── A4 と同じ、
  前景のままの `\!` で足りる。バックグラウンド化は不要だった。

どちらも Portal 内蔵ターミナルの複数タブ/複数セッション機能には依存せず、1 つ
のターミナルの中で解決できた。実装しての検証はホストの実 PostgreSQL 16 で行っ
た (2 節)。

A10・A11 (stacked #5) は「1 コンテナでは表現できない、2 ノードの物理トポロ
ジー」という、A1〜A8/A12 には無かった要求をどう解決したかを記録しておく。

- **1 コンテナから 2 コンテナへ**: このリポジトリの Database Track ドリルとし
  ては初めて、`primary`/`replica` の 2 service docker-compose 構成を使った
  (`docs/authoring/runtime-and-style.md` が既に触れている複数サービス構成自体
  は `eventbridge-delivery-discipline` 等に先例があった)。`runtime.terminal`
  は SCHEMA.json の制約どおり 1 service (`primary`、`target: participant`
  build) にしか宣言できないため、`replica` へは同じターミナルから
  `psql -h replica` で compose のサービス名解決を使って直接つなぐ設計にした
  ── Portal 側に複数コンテナへの terminal 機能を要求しない。
- **結線の自動化**: `primary` は起動時に `wal_level = replica`・専用の
  `replicator` role・物理 replication slot を用意し、`replica` は
  `pg_basebackup -R` (standby.signal・primary_conninfo・primary_slot_name を
  自動生成) で自身をブートストラップする。compose の 1st-class 機能
  (`depends_on: condition: service_healthy`) で、`replica` は `primary` の
  Node healthcheck が green になってから ── つまり replication role/slot が
  出来上がった後にしか ── 起動しないよう順序を保証した。
- **実機で踏んだ 2 つの罠 (host 検証で発見・修正)**: (1) `pg_basebackup` は
  `--checkpoint=fast` を付けないと、primary の次の自然な checkpoint (最大で
  `checkpoint_timeout` 分先) まで `waiting for checkpoint to complete` で停止
  しうる ── これはコンテナ起動直後の primary で顕著に再現した。(2)
  `pg_basebackup` の出力先ディレクトリは正確に `0700`/`0750` の permission が
  要る ── `mkdir` しただけのディレクトリ (0755 になりがち) だと standby が
  "invalid permissions" で起動を拒否する。どちらも
  `local/entrypoint-replica.sh` に明示的な対処 (`--checkpoint=fast` と
  `chmod 700`) として反映した。
- **A11 の GUC 権限は primary で付与する**: `participant` に
  `recovery_min_apply_delay` を変更させる `GRANT ... ON PARAMETER` は、standby
  (`replica`) 上では実行できない ── 実機の Postgres 16 で確認済み: 物理
  standby は `GRANT` を含む通常の DML/DDL を全て
  `cannot execute ... in a read-only transaction` で拒否する。role や
  parameter ACL (`pg_parameter_acl`) はクラスタ共有のカタログなので、
  `primary` で一度 `GRANT` すれば `replica` 側にも複製で自動的に伝わる ──
  これも実機で確認済み (`local/entrypoint-primary.sh` のコメント参照)。

### 2. Docker image のビルド・起動は実 Docker で未検証 (セッション固有の制約)

A1〜A4・A6〜A8・A10〜A12 いずれの実装セッションでも、Docker daemon 自体は起動
できたが (A10・A11 の実装セッションでは `dockerd` の起動自体には成功した)、
`postgres:16-alpine` / `node:22-alpine` を含む Docker Hub からの image pull が
ネットワークポリシーでブロックされていた
(`production.cloudfront.docker.com` への CONNECT が 403、`docker pull
postgres:16-alpine` で実際に再現・確認した)。そのため **配布する Docker image
そのものをビルド・起動しての検証はできていない**。

代わりに、apt でインストールした実 PostgreSQL 16 (`postgresql-16`, Ubuntu
noble) をこのマシン上で直接起動し、`local/db/schema.sql` → `local/db/seed.sql`
→ `local/app/server.mjs` (`postgres` JS driver 経由) → 参加者役の `psql` 操作
→ `/verify` への実 HTTP リクエストという経路を、**A1〜A4・A6〜A8・A12 それぞ
れについて before (未解決) → after (解決) の両状態で** 実行し、checkpoint す
べてが正しく false → true に反転すること、grader のロールバック系プローブが
参加者データを一切汚さないことを確認した。A10・A11 はこの経路をさらに 2 ノー
ドへ拡張し、**`local/entrypoint-primary.sh`/`entrypoint-replica.sh` そのもの
を (ポート番号と schema.sql のパスだけを host 用に置き換えて、ロジックは一切
変えずに) 実行**して primary→replica の実 streaming replication を構築し、
`local/app/pg-client.mjs`/`grader/grade.mjs` の実コードをこの実インスタンスへ
接続して checkpoint の反転を確認した (詳細は次段落)。A4 はさらに、参加者役の `psql` から
`\!` で 2 本目の psql を起動する未 commit 不可視性のデモ手順そのものを実際に動
かして確認した。A6 は blocker (`begin` して commit しない UPDATE) を
`\! ... &` でバックグラウンド化した waiter が実際に行ロックで待たされ、
`pg_stat_activity`/`pg_blocking_pids()` で blocker を特定でき、commit すると
解放される様子を実測した (`row-lock-wait-observed` checkpoint が要求する
「別 backend の commit が、こちらの UPDATE 文の実行中に起きた」という重なりも
実データで確認済み)。A7 は書き込み中の行への読み取りが実際にブロックされない
こと、単なる `begin;` (クエリ無し) は `VACUUM` を一切妨げないのに対し
`repeatable read` でクエリを 1 つ実行した後の transaction は妨げること、閉じ
て `VACUUM` すると回収されることを、いずれも実測した (「閾値の根拠」は各問題
の README を参照)。A8 は 30 万行の `DELETE` 直後に table size が変わらず
`n_dead_tup` が 30 万件前後まで増えること、手動 `VACUUM` で `n_dead_tup` が
回収される一方 table size 自体は変わらないこと、`VACUUM FULL` で初めて実際に
縮む (約 30MB → 約 7.6MB) ことを実測した。加えて anti-cheat の反証として、未
使用のテーブルに `VACUUM;` だけを実行しても全 checkpoint が false のままであ
ること、`audit.delete_log` への INSERT と `telemetry.events` への INSERT/
UPDATE がいずれも権限エラーになることも確認した。A12 は 2 万行の `DELETE`
(約 19ms) と `DETACH PARTITION` (約 1.3ms) + `DROP TABLE` (約 2.4ms) の所要時
間を同一 `psql` セッション内で比較し、桁違いの差を実測した。加えて anti-cheat
の反証として、`DETACH` すべき対象を間違えて DELETE 対象の方に使う近道が
`old-month-deleted-via-delete` を確実に落とすこと、`TRUNCATE`/`CREATE` がいず
れも権限エラーになることも確認した。

A10 は、2 つの独立した PostgreSQL 16 インスタンス (initdb で個別に作成、別
ポートで起動) を実際の primary/replica として構築し、`pg_basebackup -R` に
よる standby 構築 → streaming 開始 → primary への `wave-1` 書き込み → replica
での反映確認 → `wave-2` 書き込み → 反映確認 → `pg_wal_lsn_diff(sent_lsn,
replay_lsn)` が 0 バイトに収まることを、実際の `entrypoint-primary.sh`/
`entrypoint-replica.sh` を実行して確認した。加えて anti-cheat の反証として、
replica (`postgres` superuser 接続) への INSERT が
`cannot execute INSERT in a read-only transaction` で確実に拒否されることも
確認した。`local/app/pg-client.mjs`/`grader/grade.mjs` の実コードをこの 2 イ
ンスタンスへ接続し、3 checkpoint 全てが true になることも確認済み。

A11 は、A10 と同じ 2 インスタンス構成に加えて、`GRANT ALTER SYSTEM ON
PARAMETER recovery_min_apply_delay TO participant` を primary で実行 →
`pg_parameter_acl` が replica へ複製されることを確認 → replica に
`participant` として接続し `alter system set recovery_min_apply_delay = '8s';
select pg_reload_conf();` を実行 → primary へ書き込み → 数秒後に primary の
`pg_stat_replication.replay_lag` が実際に約 8 秒まで伸びることを実測 → delay
を `0` に戻し、primary へもう一度書き込み → `replay_lag` が実際にサブミリ秒
まで戻ることを実測した。この過程で `replay_lag` が standby からの feedback を
受けた瞬間だけ更新される値であり、常時カウントアップするタイマーではないこと
も実データで確認した (delay 設定を変えただけでは古い高い値が残り続け、新しい
書き込みが無いと更新されない)。`local/app/pg-client.mjs` の実際の
`startLagSampler` を稼働させ、`grader/grade.mjs` の実コードで
`streaming-replication-topology-active`/`lag-induced`/`lag-resolved` の 3
checkpoint が、何もしていない状態→lag 発生後→lag 解消後の順で正しく
false→false / true→false / true→true と遷移することも確認した。

これは `postgres:16-alpine` と同じ PostgreSQL 16 系エンジンだが、**配布物その
ものではない**。Docker が使える環境での
`make local PROBLEM=db-a1-table-primary-key` 等 10 問それぞれの最終確認は未実
施であり、one-time verification として残る (詳細は PR 本文の Validation 節)。

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
