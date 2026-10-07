# 本体登録と完了条件

このPR単独では、ローカル2席が同じPortal componentとcoordination pluginで対戦する試作。主催者がTenkaCloudのイベントから選び、本体のチーム認証・永続化・公式点で遊ぶ状態にはまだ登録していない。

読取参照したTenkaCloudは`05ffed84`。実`coordination-core.ts`のcreateMatch/transitionMatchへ同じpluginを渡し、4ラウンドの170–170、JSON roundtrip、再送delta 0を確認した。実browser catalogも109件を読み、この試作を除外することを確認した。これはhook互換性の証拠であり、本体HTTP認証やSQLite統合の証拠ではない。

| 本体の場所 | 現状 | 必要な変更 |
| --- | --- | --- |
| `scripts/local-host/coordination-runtime.ts:coordinationCatalog` | 暗号Battleの固定ID1件 | レビュー済みID一覧にsession-defenseを追加し、既存LocalPluginLoaderで`coordination/session-defense.ts`をbundleする |
| `scripts/local-host/browser-metadata.ts` | native runtime、dashboard、coordination、Portal glob/module許可は暗号Battle専用 | この競技だけを許可し、Portalと公開CSSだけをブラウザへ渡す。`game/reducer.ts`、試合秘密、tests、運営資料は渡さない |
| `scripts/local-host/service.ts` / `coordination.ts` | 本体認証、イベント窓、SQLiteの状態・得点同時保存は既存 | 初期化前に正確に2チームを検査し、第三チーム追加、開始前、終了後、lock、別イベントを拒否。readyを押す前に両team jobを準備する |
| `apps/participant-portal/src/plugins/loader.ts` | metadataにあるslotを実componentへ解決 | 認証済みの既存coordinationClientをStatusPanelへ注入する。席URLとdev serverは本体へ持ち込まない |
| catalog `SCHEMA.json` / `scripts/validate-problems.ts:checkCrossRefs` | 現行native coordination専用の登録分岐は未整備 | 対応するnativeだけを狭く検証する。存在しないCFn/Compose/verifierを作って実行対応と見せない |

問題側は本体対応と同時に`battles/_session-defense`を`battles/session-defense`へ移し、日英metadataを追加する。`interTeamCoordination.plugin=coordination/session-defense.ts`、`dashboard.slots.StatusPanel=portal/StatusPanel.tsx`を既存形で指定する。提案runtimeは`{provider:local,engine:bun,entry:coordination/session-defense.ts}`だが、本PRでは対応済みのschema値として登録しない。stateBudgetは最大入力・最大長合法履歴・ホストのJSON envelopeを実測して確定する。本PRの13,169 bytesは短いテストIDを使ったtraceの測定値で、登録上限の保証ではない。

underscore名は本体のeligible directory正規表現から外れる。metadataなしの通常名にすると本体の全ディレクトリ読込を壊すため、未登録の試作はこの配置を維持する。共有manifestは変更していない。並行PR900は`battles/_pi-siege`と`pi-siege.yml`を所有する。本PRは`_session-defense`と専用CIだけを所有し、両者を一緒に本体登録する場合は同じレビュー済み一覧への追加を1つの連携PRにまとめる。

新しい採点kindや別ゲームAPIは不要。既存`initialState/validateOp/applyOp/tick/projectForTeam/teamScores`を使う。matchSecretは本体が発行する。演習用証拠で本体認証を代用しない。正規操作のowner/reviewerは教育用の模型であり、本体参加者認証と同じセッションとして扱わない。

完了条件は、主催者カタログから選択 → 2チーム作成・開始 → 別々の本体参加者ログインで4ラウンド → 公式score/historyとplugin値一致 → ホスト停止・再起動で状態とreceipt復元 → 終了/lock/teardown確認まで。本体bundleにserver stateと他人の許可が入らない検査、既存暗号Battleの継続、日英・狭い画面のUI試験も行う。これらの証拠が得られるまで「Tenka統合済み」とは呼ばない。
