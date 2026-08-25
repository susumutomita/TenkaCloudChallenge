# cs-foundations — 動かして、壊して、監査する計算機科学の基礎

Issue 407。`track.id` は `cs-foundations`。`index.json` から機械可読で、ポータルの「講座トラック」画面は
この順序を読む。

## なぜ作るか

`advanced-cryptography-2026` (31 問) を通しで解いた結果、あの講座の**設計パターン**が題材から独立して
効いていることが分かった。パターンはこう要約できる。

> 壊れた実装の大半が、最終出力を見るテストを通過してしまう。監査系の checkpoint だけが本当の欠陥を
> 検出できる。

暗号が難しいから効いていたのではない。「動いているように見えるものを、動いていることを理由に信用して
はいけない」を、**参加者自身のコードで一度証明させる**構造が効いていた。この構造は CS の基礎領域でも
そのまま成立する。

同時に、これは今の実務の需要と重なる。AI にコードを書かせる人が増えるほど、「動いた」と「正しい」の
距離を測れることの価値が上がる。この track の切り口は「バイブコーダー向けのコンピューターサイエンス」
であり、CS50 的な網羅ではなく**検証の作法**を軸に領域を選ぶ。

## 設計上の約束

`advanced-cryptography-2026` の [`TEMPLATE.md`](../advanced-cryptography-2026/TEMPLATE.md) の
container / `/verify` 契約をそのまま使う。この track 固有の約束は次の 4 つ。

1. **公開テストは、壊れた starter を通す。** 通してはいけない問題もあるが、この track の既定は「通す」で
   ある。通してしまうことを公開テスト自身が明記し、著者ガードのテストがその性質を固定する。
   「テストが緑」を一度壊しておかないと、監査 checkpoint が成立しない。
2. **監査対象は、他人が下した判断である。** 参加者は自分のコードのバグを探すのではなく、**すでに本番で
   動いている実装の決定ログ**を読む。答えは seed 由来で、別の起動の答えは当たらない。
3. **答えは 1 問につき 1 つの飛躍に絞る。** 「A を検証した」から「B を保証できる」への飛躍を 1 つ選び、
   その飛躍だけを問題全体で扱う。複数の欠陥を混ぜると、どれが主題だったのか分からなくなる。
4. **`courseAlignment` は持たない。** この track は外部講座の伴走ではないので、上流 SHA を pin しない。
   `scripts/check-course-drift.ts` の対象にもならない。

## 章立て

| order | 問題 | 難易度 | 章 | 扱う飛躍 |
| --- | --- | --- | --- | --- |
| 10 | `cs-auth-claim-audit` | d3 | 1. 信用の境界 | 署名が通った → その要求を通してよい |
| 20 | `cs-transaction-visibility-audit` | d3 | 2. トランザクションと可視性 | 各 read が committed → 同じ瞬間を見た |
| 30 | `cs-async-result-binding` | d3 | 3. I/Oと並行性 | 各 I/O が正しい → 完了結果を正しい request に結び付けた |
| 40 | `cs-cache-generation-fence` | d3 | 4. キャッシュ無効化 | invalidate が完了した → 古い値は戻らない |
| 50 | `cs-http-retry-idempotency` | d3 | 5. HTTP再送と冪等性 | 応答を受け取れなかった → 操作は起きなかった |
| 60 | `cs-atomic-file-publish` | d3 | 6. 公開の不可分性 | 書き終えた内容は正しい → 公開そのものが不可分だった |
| 70 | `cs-numeric-aggregation-order` | d3 | 7. 集約の順序と精度 | 各値は正しい → 合計は行の順序に依存しない |
| 80 | `cs-protocol-state-guard` | d3 | 8. 状態機械と既定拒否 | 正常系の手順は通る → 手順を飛ばした相手も既定で拒否される |
| 90 | `cs-dst-daily-rollup` | d3 | 9. 暦の日と、86400 秒の塊 | 固定 offset で日を切れる → 暦日は必ず 86400 秒とは限らない |
| 100 | `cs-pagination-drift` | d3 | 10. 一覧の分割と動くデータ | 位置で分割すれば全件揃う → 動くデータでは位置が意味を変える |
| 110 | `asm-worst-case-latency` | d4 | 11. 命令 1 個の最悪実行時間 | 1 命令は一瞬で終わる → 依存関係が先読みを止めると 2 桁遅くなる |

第 1 章から第 11 章まで実装済み。1-5 章は時間や実 network に依存せず、immutable revision、明示的な
`asyncio.Future` gate、late-fill schedule、commit 後の response drop trace で境界の逆転を再現する。
6-10 章 (第 2 期・第 3 期) も同じ制約を守り、rename の原子性、Kahan 和と Largest Remainder、状態機械の
全遷移表、tz database ベースの暦日境界、keyset pagination をそれぞれ決定論的な fixture と hidden
phase で再現する。11 章 (`asm-worst-case-latency`) だけは「監査対象の決定ログを読む」形ではなく、
作者所有のハーネス上で参加者が命令 1 つのレイテンシを実測して押し上げる形式で、この track のもう 1 つの
軸——**動作すること (速く終わる) と、設計が前提にしていること (最悪ケースの実行時間) が別物である**
——を扱う。「壊れた実装が公開テストを通過する」という 1-10 章の形そのものではない派生形なので、次に
章を足すときは 1-10 章の形へ戻すか、11 章のような派生形を明示的な選択として扱うかを先に決める。

## 実装した章の根拠

Issue 407 は対象領域としてアルゴリズム / ネットワーク / DB / 並行性 / OS を挙げている。この track の
判定基準は網羅ではなく「**壊れた実装が動作テストを通過するか**」なので、その基準で並べ替える。

### 採らなかったもの: ソート・探索・グラフ

Issue が最初に挙げている領域だが、この設計パターンには合わない。壊れたソートは公開テストで落ちる。
`sorted()` と比べるテストを 1 行書けば終わりで、「監査でしか見つからない欠陥」を作るには、性能特性や
安定性など**出力以外の性質**へ逃げるしかない。それは別の良い問題ではあるが、この track の軸ではない。

### 順序と、その根拠

1. **認証・トークン検証** (実装済み: `cs-auth-claim-audit`)
   飛躍が最も短く、題材が最も具体的で、正しい実装と壊れた実装の出力差が **1 つの要求**に現れる。
   最初の章に必要な条件をすべて満たす。
2. **トランザクションと可視性** (実装済み: `cs-transaction-visibility-audit`)
   「commit された」から「読んだ人が見た状態は正しかった」への飛躍。read committed で走るコードは、
   commit が read 間に無い単体テストでも結合テストでも緑になり、read 間に commit が入ったときだけ
   壊れる。実 thread や timing ではなく immutable revision と決定論的 schedule で、監査対象を
   「一貫していないまま返された応答のログ」に固定する。
3. **並行性 (I/O 境界)** (実装済み: `cs-async-result-binding`)
   「各処理は正しい」から「並べても正しい」への飛躍。決定的に再現させる仕掛けが要るので、
   トランザクションの後に置く。
4. **キャッシュ無効化** (実装済み: `cs-cache-generation-fence`)
   「cache に入っていた」から「その値は今も正しい」への飛躍。2 と 3 の語彙 (可視性、順序) が前提。
5. **プロトコル (HTTP / 再送 / 冪等性)** (実装済み: `cs-http-retry-idempotency`)
   「応答を受け取れなかった」から「操作は起きなかった」への飛躍。commit後にresponseだけが消えるtraceを
   読み、同じlogical operationをdurable receiptからreplayする。保証はexactly-once transportではなく、
   at-most-once business effectに限定する。前4章の語彙が再登場する位置なのでorder 50に置く。

第 2 期 (order 60-90) は Issue 407 コメントで事前に相談してから着手した。基準は 1 期と同じ
「**出力は正しいのに性質が壊れている**」領域だけを選ぶこと。

6. **ファイル公開の atomicity** (実装済み: `cs-atomic-file-publish`)
   書き終えたファイルの中身は正しい。書いている最中に読んだ側が半分のファイルを見る。
   `db-a4-transaction` は SQL transaction の可視性を扱うが、こちらは filesystem の可視性境界で非重複。
7. **数値集約の順序と精度** (実装済み: `cs-numeric-aggregation-order`)
   合計は出るし小さい入力では一致する。桁が離れると加算順序で結果が変わる。新規領域。
8. **プロトコル状態機械** (実装済み: `cs-protocol-state-guard`)
   正常系のハンドシェイクは通る。状態を飛ばした遷移も受理してしまう。`signed-does-not-mean-safe` は
   署名検証、こちらは順序と状態で非重複。
9. **時刻境界の日次集計** (実装済み: `cs-dst-daily-rollup`)
   集計値は出るし固定日付のテストは通る。DST の日だけ二重計上または欠落する。新規領域。

第 3 期 (order 100-110) は Issue 407 上の事前相談を経ずに追加された (`cs-pagination-drift` は
PR #479、`asm-worst-case-latency` は PR #484)。**既知の断絶**に記録する。

10. **一覧のページネーションと動くデータ** (実装済み: `cs-pagination-drift`)
    offset ページネーションは静止データでは全件揃う。動くデータでは行の挿入・削除で位置がずれ、
    同じ行を二重に見せるか、1 行を丸ごと飛ばす。1-9 章の「出力は正しいのに性質が壊れている」型を
    維持している。
11. **命令 1 個の最悪実行時間** (実装済み: `asm-worst-case-latency`)
    「1 命令は一瞬で終わる」という前提を、命令を遅くする側から壊す。1-10 章とは形が異なる派生章
    (上の章立て表の注記を参照)。

### 既知の断絶

- **1 章の前に置く導入が無い。** `cs-auth-claim-audit` は難易度 3 で、Python を読み書きできることと、
  HMAC が「鍵付きハッシュ」であることを知っていることを前提にしている。まったくの初学者はここから
  始められない。`stackstack-route` の 1-2 章が近い役割を果たすが、あちらは AWS 運用の導線であって
  この track の前提ではない。難易度 1-2 の導入問題が要る。
- **第 3 期は Issue 407 上の事前相談を経ていない。** 1 期・2 期は「領域選定 → コメントで合意 → 個別
  Issue 分割 → 実装」の順を踏んだが、`cs-pagination-drift` と `asm-worst-case-latency` は Issue へ
  相談コメントを残さないまま追加された。両方とも実装内容はこの curriculum の判定基準に沿っているが、
  章立ての合意プロセス自体は途切れている。次の章を足す前に、この断絶を埋めるか、恒久的な運用として
  追認するかを決める。
- **この文書と `challenges/cs-*/metadata.json` の突き合わせは、これまで手作業だった。** 1 期
  (order 10-50) を書いた後、2 期・3 期が実装されてからも表が更新されないまま 3 回のリリースが進んだ
  (commits `9d308e3`..`5c518f6` で表を書き、その後 `#435`-`#438`、`#479`、`#472`、`#484` で
  order 60-110 の 6 章が増えたが、この文書は order 50 のまま止まっていた)。
  `scripts/cs-foundations-learning-path.test.ts` がこの表と `track.order` / `track.chapter` の一致を
  機械的に固定し、この drift を再発させない。

## 関連

- Issue 407 — この track の起票元
- Issue 428 — cache generation fence の受け入れ条件
- [`advanced-cryptography-2026/TEMPLATE.md`](../advanced-cryptography-2026/TEMPLATE.md) — container と
  `/verify` の契約、assurance scope の正本
- [`stackstack-route`](../stackstack-route/curriculum.md) — もう 1 つの学習ルート。目的地が AWS 運用で、
  この track とは前提も終点も別
