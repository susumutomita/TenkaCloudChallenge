# 見えるものしか守れない (`sre-incident-readiness`)

**Battle · difficulty 4 · 90〜120 分 · Docker 完結 · USD 0**

SRE Battle #1 (Issue 470)。正常に動いている注文サービスがあります。チームでまず監視と耐障害性を作り、そのあとで原因を伏せたインシデントが発生します。平時にどれだけ「見える」状態を、どれだけ「壊れにくい」状態を作れたかが、そのまま検知の速さと被害の小ささに直結します。

> 勉強したチームではなく、勉強して実装したチームが強い。

## 4つのフェーズ

| フェーズ | 何が起きているか |
| --- | --- |
| **Build** | サービスは正常です。メトリクス・ログ・アラート・timeout/retry/circuit breaker を作ります。 |
| **Calibrate** | 無害な揺れ（アクセス増加、1回だけの依存先遅延、deploy marker）が流れます。アラートが鳴りすぎないよう調整します。 |
| **Incident** | 依存先が本当に詰まります。発生時刻は seed によってランダムで、教えられません。 |
| **Stabilize** | SLO が本当に戻ったことを確認してから resolve します。 |

## 仕掛け (Variant A: 遅い依存先 → retry storm)

`payment-gateway`（seed によって別名の場合あり）が、インシデントの間ずっと完全に詰まります。checkout がこの依存先を呼ぶたびに、共有 pool のスロットを `(1 + maxRetries) × timeoutTicks` tick だけ占有します。starter の既定値 (`timeoutMs: 15000`, `maxRetries: 6`, circuit breaker 無効) では、この占有時間が長すぎて pool (30スロット) が数 tick で枯渇し、依存先を呼んですらいない `order-status` route まで拒否されるようになります。短い timeout・少ない retry・有効な circuit breaker の組み合わせだけが、この枯渇を防ぎます。この差は config に対して完全に決定論的で、どの seed でも再現します。

参加者コードの実行はありません。編集できる面 (`local/app/config-store.mjs`) はすべて小さく型付けされた in-memory config です。resilience パラメータ（実際に挙動を変える）、observability の切り替え（常に計算されている真実への可視性を切り替えるだけ）、アラートルール（静的解析ではなく、実際の per-tick メトリクスに対して評価される）。詳しい理由は同ファイルの冒頭コメントを参照してください。

## 後から見えるようにしても過去は見えない

証跡は、該当 capability (`dependencyMetrics` または structured logs) が **その tick の時点で** 有効だった場合にのみ記録されます。過去に遡って証跡を書き足すコードパスはありません。インシデント開始後に capability を有効にしても、それ以降の記録は増えますが、それより前の記録は増えません。

## Incident Command

アラートが鳴っただけでは時計は動きません。チームが明示的に宣言し (`POST /incident/declare`)、役割 (`ic`/`ops`/`comms`/`scribe`。3人チームでは comms と scribe の兼任可) を割り当て、すべての fact と hypothesis に本物の evidence id を添える必要があります。`gradeHypothesis` (`local/app/incident.mjs`) は自由記述を一切読みません。dependency 名・mechanism 名・引用した evidence id のうち少なくとも1つが本物であることだけを見ます。

## 採点 — 1000点、Issue 本文の表と1:1対応

| checkpoint | 点数 | 条件 |
| --- | ---: | --- |
| `readiness-efficacy` | 150 | 作ったルールが、Build/Calibrate 中に一度も誤発火せずに本物の発生を捉えた |
| `detection-declaration` | 150 | 本物の発生時刻以降に明示宣言し、2つ以上の役割に担当者がいる |
| `evidence-based-diagnosis` | 150 | 採用された hypothesis: 正しい dependency・正しい mechanism・本物の証跡 |
| `customer-impact` | 250 | 累積の影響予算が 700/1000 を上回ったまま |
| `safe-containment` | 200 | `order-status` が健全なまま、pool の枯渇時間がインシデント時間の10%未満、全停止/injector到達試行が無い |
| `incident-command-closure` | 100 | 宣言済み・override 解除済み・structured update 投稿済み・SLO が実際に戻っている状態でのみ resolve できた |

Battle カテゴリのため `SCORING.md` の tier 配点規制は対象外です (`checkScoringRegulation` は `category === "Challenge"` のみを見ます)。

## 高速なローカル検証

90〜120分を数十秒に圧縮して Docker で手動確認する場合:

```bash
SRE_TICK_MS=50 SRE_BUILD_TICKS=5 SRE_CALIBRATE_TICKS=5 SRE_INCIDENT_TICKS=40 \
  SRE_STABILIZE_TICKS=10 FLAG_SEED=demo docker compose -p sre-incident-readiness -f local/docker-compose.yml up --build
```

本番 (ポータル起動時の既定) は `SRE_TICK_MS=1000` で実際の90/120分スケジュールを使います。上記は手動デモ実行のときだけ上書きしてください。

## コストと安全性

ゼロ。単一コンテナ、loopback のみ、non-root、read-only root filesystem、全 capability drop。参加者コードは一切実行しないため、サンドボックスすべき任意コード実行面がそもそも存在しません。model API key・AWS credential・GitHub token は不要です。

## 既知の制約 (詳細は PR 本文)

この PR は Issue の実装順にある Milestone 1 (Variant A のみの垂直スライス) を出荷します。Variant B (bad revision / partial failure)、OTel 分散トレース伝播、Runbook 実行エンジン、実 Prometheus/Alertmanager、TenkaCloud portal 統合は follow-up です。

## Related

- `challenges/stackstack-observability` (#288) — このBattleが到達先として想定する単体 Challenge
- `battles/agent-approval-gameday` — Workbench / gateway / verify の形を借りたインシデント対応Battle
