# session-defense 専用の本体連携契約（共有変更の調整前）

本体・カタログ共通コードはπ担当と競合するため未編集。こちらの専用ブランチは `feat/session-defense-native`、カタログworktreeは `/Users/susumu/Documents/Codex/2026-10-07/task-3/session-native`。試作PR901のbranch/headを変えない。

共有所有者はπ担当（`01a114fa-bd26-70f1-aa78-e506398a90dd`）。本体 `scripts/local-host/coordination-runtime.ts`、`browser-metadata.ts`、`service.ts`、`coordination.ts`、関連host tests、およびカタログ `SCHEMA.json`、`scripts/validate-problems.ts` をこちらでは編集しない。親がこの通常回答を読み取り、π担当へ契約を渡す。別スレッドへの直接送信は行わない。

この競技のIDは `session-defense`、categoryはBattle。runtimeは `local/bun`、entryおよびinterTeamCoordination.pluginは `coordination/session-defense.ts`、StatusPanelは `portal/StatusPanel.tsx`。既存hookの絶対teamScoresを採用し、新しい採点kind・exercise API・Docker verifier・CloudFormationは追加しない。独立の `docs/native-metadata.json` は登録候補であり、共通validatorと本体allowlistの対応確認後に正規ディレクトリのmetadataへ移す。正規のreviewed problem pathは `battles/session-defense`、UI public moduleは同pathのPortalのみ（dev harness・reducer・private stateをブラウザbundleへ取り込まない）。

rosterは正確に2チーム。作成・prepare/start・開始後のチーム追加で不正rosterを先に拒否し、pluginの初期化例外まで進めない。既存暗号Battleの多数チーム制約は維持する。同じeventは既存のcoordination Battle1件制約を維持するため、πとこの競技を同一eventへ同時選択しない。

event/team/jobは本体の認証済みcontextで決まり、operationのpayloadから指定しない。`lab_session_…` は模擬管理アプリだけの証拠。`lab_grant_…` はserver privateで、別席・別eventへ出さない。`dev_seat_…`を発行するdev harnessは本体へ取り込まない。初期秘密は本体のmatchSecretを使う。

状態schema1、JSON復元可能。状態・絶対scoreの差分・履歴は既存LocalCoordination/HostStoreの同時transactionを使う。receiptは同一操作の再送とHTTP idempotency両方を確認する。ホストclock、event終了、lock、停止中の時間経過を変えない。正常停止時のflushと再起動時のSQLite復元を実UI経路で検査する。

専用pluginは `stateSchemaVersion:1`、`tickOnRequest:true`。eventIdとteamIdはASCII 1〜80文字、teamNameは80 UTF-16単位以内、matchSecretは本体発行の64桁hexを要求する。本体の26文字ULID/80単位displayName/32バイト秘密と互換。opはstrictな `id`（ASCII最大64）、`revision`、`kind` に加え、その操作専用fieldだけを受理する。teamId/eventId/jobId/時刻/score/verified等をpayloadへ追加すると拒否する。projectForTeamはteamの所属を確認し、攻撃役にだけ意図した演習用leakを渡す。private secret/sessions/grants/receiptsは渡さない。

候補stateBudgetは `{baseBytes:0, bytesPerTeam:16384}`。対応範囲は正確に2チーム、計32,768 bytesであり、3チーム以上への線形予測ではない。`tests/capacity.test.ts` は80文字ID・80単位JSON escape最大の名前・80文字event・64文字request IDを使い、全74の合法control組合せ×4経路=296試合の全transitionを測定。通常経路50receipt、timeout経路46receipt。最大27,065 bytes。JSON復元・私有projection・score・同一再送も各transitionで比較した。任意のmixに対する絶対最大値と称さず、同時に入力長・4round・券数・history数の上限を固定する。

こちらの独立所有範囲: `battles/_session-defense/**`（登録後は`battles/session-defense/**`）、セッション専用の認可・metadata・容量・DBSC説明テスト、専用本体 `scripts/local-host/tests/session-defense-*.ts`、セッション固有の連携文書。共有pathは合意まで編集しない。

完了の証拠: 主催者UIでこの競技を選んで2チームevent作成・準備・開始 → 各チームの本体ログインからStatusPanelを操作 → 公式順位・履歴とgame score一致 → hostを正常停止し同じSQLiteで再起動 → チーム再ログイン、round/期限/receipt/得点継続、同一操作の再送で二重加点なし。別team/event、第三team、開始前/終了後/lockの拒否、既存暗号Battleの回帰も必要。
