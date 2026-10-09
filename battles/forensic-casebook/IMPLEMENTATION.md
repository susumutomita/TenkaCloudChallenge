# 端末ケース実装・検証記録（2026-10-09）

## 実装前の影響判断

- 問題 main は `41d6300148ea57db977b1ddc5a07664f4e7fcb00`、本体 main は `40b6ab281a58d9b5103a5599e786f7932a4d0fd0`。GitHub読み取りで同じ最新SHAを確認。
- 問題の open Issue #906 / draft PR #908 は Skill Evidence の宣言、#897 は別暗号問題。本体 open #3343 は事後レポート、#3314 は AWS サインインで、今回の端末ケース実装とは重複しない。
- 元の問題 checkout は別問題に未commit変更あり。ローカルcloneの独立ブランチ `feat/endpoint-update-return` を origin/main から作成し、元の変更は取り込まない。
- 両リポジトリの AGENTS.md を確認。`.agents/skills` は存在しない。memory は判断に不要で未参照。
- 既存 forensic-casebook の根拠集合採点・Portal・coordination登録を再利用。新規問題や本体登録を増やさず第4ケースにする。既存9問300点は維持、端末6問100点を追加し総計400点。
- 全操作は既存の answer/hint 契約内。端末の回答成功順から模擬状態を導出するため保存の追加データは最小。第4ケースの進捗キー追加は状態版2として扱う。

## 境界と設計

診断 → 変更前保全 → 対象限定封じ込め → 正常更新復旧 → 模擬再起動 → 観測評価。
根拠不足・余分な引用・順序違反・正常対象削除・全通信停止・ファイルだけの削除は
不正解で模擬対処を進めない。誤答の受付revision/attemptは進む。再起動自体は0点。
保全受付は元3記録の内容・SHA-256を保持し、元証拠は変更しない。

未収集helperの分類、長期安全、実OS修復は断定しない。得点はチーム結果で個人認定ではない。
実マルウェア、実認証情報、OS永続化、外部通信、社内SSRF資料は使わない。

本体のローダーは状態版>1で移行関数を要求する。`migrateState` は既存イベントの状態を
捨てたり拡張したりせず、明示的に拒否する。本体の既存固定済みバンドルは既存イベント用に
残し、この版は新規イベント用。新規登録・本体ソース変更はない。

## 検証済み

- `make install`、問題内 `make install`（既存lock、scripts無効）。
- `make -C battles/forensic-casebook check`：型検査、26テスト・602 assertions。
  既存9問回帰、端末6問を8世代、根拠不足/余分/順序/危険対処/実修復の過大主張、
  保全内容、JSON再読込、受付再送、チーム分離、版1拒否、最大100席保存予算。
- `make agent-gate`：130 metadata妥当、native runtime/coordination 5テスト・41 assertions。
- 既存Chromeで `BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' make browser-test`：
  実Portal全15問を日英、端末診断の3段階ヒント、証拠ダウンロード・SHA-256、
  危険対処拒否、再起動観測、2席分離、応答喪失再送、確認付きリセット、390px、console例外なし。
  `dev/evidence/endpoint-ja.png`、`endpoint-en.png` ほかを生成。日本語画面を目視確認。
- 本体 `coordination-core.ts` の `createMatch` / `transitionMatch` を新版pluginで直接実走：
  新規版2・満点400の受入れと初期0点、版1更新の migration_failed 拒否を確認。
- 独立Codexレビュー：採点・安全境界の重大不具合なし。問別ヒントと状態版契約の指摘を対応。
  再レビューで型とgame/endpoint 21テスト・541 assertions成功。reviewer環境のHTTP起動は
  sandboxで失敗し独立HTTP検証未完了。実装担当のHTTP/ブラウザ成功とは分けて扱う。

## 未検証・未実施

配備、実イベント、実OS、長期観測、第三者プレイテスト。本体の全問題・全HTTPやクラウド保存adapterは未検証。
本体の全標準ゲートは本体変更がないため実行していない。
push、PR作成、マージ、リリース、デプロイ、認証設定変更は実施していない。

## 追加検証と保存互換性（同日）

本体の独立clone、専用SQLite fixtureと別headless Chromeを使用し、既存ユーザーイベント・
既存ブラウザに触れず実施した。既存依存を読み取りで再利用し、新しいモデルは取得していない。

重要な発見：旧イベントのサーバーは固定済みbundleだが、UIは現在のbuildである。
初版UIの満点400限定は旧projectionの300点を拒否したため、型と判定を300|400にし、
ケース件数をprojectionから表示する修正を行った。現在metadataの短文も旧イベントの問題情報に
使われるため、ケース件数を含めない説明にした。これは旧状態移行とは別の表示互換性である。

保存経路の根拠：本体 `service.ts:createEvent` は選択したproblem定義をevent.problemsにコピーし、
`store.ts:putEvent/event` がそのJSONをSQLiteに保存・再読込する。`coordination.ts` はeventの
problemを使用し、`LocalPluginLoader.load` はその保存定義のbundle/digestを検証して読み込む。
本体ローカルhostの再起動時に現在catalogの同名problemへ差し替える処理はない。旧版固定イベントには新版の
migration関数は呼ばれない。新版pluginへ旧保存状態を強制差替えするケースだけ明示拒否する。

- 既存本体 forensic HTTP / coordination-core / browser-metadata：15テスト3072 assertions成功。
- 追加本体HTTP/SQLite：1テスト57 assertions成功。旧実bundleで新規fixtureイベント作成・
  20点獲得→現catalog版2で再起動→旧projection完全一致・保存版1維持・追加30点成功。
  別の版2イベントは端末6問100点、保全後・完了後再起動、受付再送無加点、別席0点、
  保全内容、模擬再起動1回、公式5履歴を確認。
- 本体UIビルド成功。既存Chromeの独立headless実走：実organizerで旧fixtureを作成・配備・
  開始。現在Portalで300点旧3ケースを操作でき、別hostプロセス再起動後も継続。
  新規版2イベントを同じ実UIで作成し、公開証拠だけで端末6問を完了。正常対象削除と全通信停止を
  拒否、保全後の別プロセス再起動で内容保持、完了後も100/400・公式100点・5履歴・別席0点。
  旧イベントも20/300のまま保持。pageerrorなし。
- 独立Codex再レビュー：表示互換性変更に問題なし。型・game/endpoint 21件541検証成功。

再現用は `tests/host-integration/README.md` と test-only `fixture.patch`。
本体の正本ソース変更、既存DB移行、旧イベントのbundle差替えは不要。

スクリーンショット追加時のfixture再撮影で、認証済みページに再ログインする遷移がタイムアウトした。
既存認証でPortal内を移動するようtest-onlyコードを直し、最終本体ブラウザ全経路を再実行して成功。
