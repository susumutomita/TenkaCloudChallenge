# 本体登録と完了条件

この連動PRは `battles/session-defense/metadata.json`、coordination plugin、Portal slotを正規pathへ置く。共有native schema/validatorと本体登録はπ担当が所有する。こちらでは共有ファイルを変更しない。[試作PR901](https://github.com/susumutomita/TenkaCloudChallenge/pull/901)も維持する。本体の主催者選択・チーム認証・SQLite復元・公式点を確認したという意味ではない。

| 連携点 | 共通担当が実装する契約 |
| --- | --- |
| `coordination-runtime.ts` | reviewed path `battles/session-defense`、ID `session-defense`、plugin `coordination/session-defense.ts` を既存LocalPluginLoaderへ登録 |
| `browser-metadata.ts` / Portal loader | metadataのruntime/dashboard/coordinationを公開projectionへ含め、実 `portal/StatusPanel.tsx` とCSSを許可。reducer・秘密・tests・dev serverは公開しない |
| `service.ts` / `coordination.ts` | event作成・準備・開始・チーム追加で厳密に2チームを検査。既存認証、event時間窓、lock、score/state/history同時transactionを利用 |
| catalog `SCHEMA.json` / validator | Battleの `runtime={provider:local,engine:bun,entry:coordination/session-defense.ts}`、空exposedPorts、coordination/StatusPanel必須を狭く検証 |

問題の得点は既存 `teamScores` の絶対値を使う。新しいscoring kind、exercise API、CFn、Compose、外部URL、公開endpointは追加しない。同一eventは既存coordination Battle1件制約を守る。

stateSchemaVersion1、tickOnRequest。matchSecretは本体が発行する。ホスト席の認証情報と `lab_session_…`、privateな `lab_grant_…` は完全に別用途。dev harnessの `dev_seat_…` は本体へ取り込まない。owner/reviewerの操作許可はサーバー内の教育用模型であり、パスキーや別担当者の独立ログインの実装ではない。

対応人数は正確に2チーム。候補予算は `baseBytes=0, bytesPerTeam=16384`、合計32,768 bytes。最大長のhost入力で74合法control組合せ×4経路=296試合、全transition・JSON復元・replay・scoreを測定し最大27,065 bytes。人数を増やした予測ではなく、混合全経路の数学的絶対最大とも称さない。[契約](NATIVE-CONTRACT.ja.md)と `tests/capacity.test.ts` を参照。

完了の判定は、指定された連動host/catalog SHAで次を確認して記録すること。

1. 主催者UIでセッション防衛戦を選び、2チームeventを作成・準備・開始。
2. 別々の本体参加者ログインで実StatusPanelから4ラウンドを操作。
3. 公式score/historyとplugin値の一致、同じoperation再送で二重加点なし。
4. 正常停止後、同じSQLiteでhostを再起動。再ログインしてround/期限/receipt/得点の継続を確認。
5. 別team/event、第三team、開始前・終了後・lockの拒否、既存暗号Battle回帰を確認。

未完了の検査はEVIDENCE.mdで明記する。読み取りで参照した既存host `05ffed84` のcore互換性・JSON復元は、本体HTTP認証やSQLite停止復元の証拠とは区別する。
