# Enter を押す前に (`agent-approval-gameday`)

**Battle · 難易度 3 · 45〜60 分 · Docker だけで完結 · USD 0**

AI で構築された注文 API で不審な操作が検知されます。エージェントに渡す能力を 3 段階で解禁
しながら、何を承認するかを決めます。

この問題が問うのは「AI を使えるかどうか」ではありません。**どの権限をいつ渡し、何を確認して
から実行を承認するか**です。

## シナリオ

環境には、名前もタグも似たリソースが並んでいます。侵害された worker、正常な本番 API、検証用の
canary、監査証拠ストア、そしてそれら全部が依存している共通設定。

届く依頼はこう書かれています。

> suspicious なリソースをすべて停止して、不要なものを削除し、安全な状態にしてください

もっともらしく見えます。しかし、以前の別件の調査で付いたまま残っている `suspicious=true` タグで
解決すると、監査証拠も含まれ、依存関係を通じて本番 API まで巻き添えになります。

正しい対応は、**証拠を保存したまま侵害された対象だけを隔離し、本番を止めない**ことです。

## 3 つのフェーズ

| フェーズ | gateway が公開する tool | やること |
| --- | --- | --- |
| 1 (0〜15 分) | なし | 自分で証跡を読み、構造化した仮説を出す |
| 2 (15〜30 分) | `list_resources` / `describe_resource` / `read_logs` / `show_dependencies` / `read_local_runbook` / `evaluate_plan` | エージェントと調査する。何も変えない |
| 3 (30 分〜) | 上記に加えて `propose_change` / `preview_change` / `execute_change` / `rollback_change` / `verify_post_conditions` / `revoke_operator_capability` | 変更する。ただし propose → preview → approve → execute の順にしか通らない |

フェーズは**サーバ側**の時計で開きます。クライアントが「いまフェーズ 3 です」と名乗ることは
できませんし、フェーズ 2 で発行した token はその後もフェーズ 2 の token のままです。そうしないと
「read-only」が「時計が進むまでの read-only」になります。

フェーズ 1 は、プラットフォームの外で AI を使ったかどうかを検知しようとはしません。技術的に
不可能ですし、それは学習目標でもありません。強制しているのは**この問題に付属する tool への
アクセス**だけで、イベント規約としての AI 禁止は運営側のルールです。

## 変更が通る手順

1. `propose_change` が**変更不能な**提案を作ります (対象 selector、操作、証跡、期待する事後条件、
   戻し方)。
2. `preview_change` が selector を**いまの世界に対して解決**し、何が変わるか、他に何に当たるか、
   それに依存して巻き添えになるものは何かを返します。あわせて、その解決結果に対して計算した
   `approvalDigest` を返します。
3. `execute_change` はその digest を要求します。preview 後に世界が動いていれば digest はもう
   その実行を説明していないので、黙って解決し直さずに拒否し、監査へ記録します。
4. 再観測します。`verify_post_conditions` は外部状態を読みます。エージェントに「うまくいった?」
   とは聞きません。
5. `rollback_change` で元に戻せます。**`delete` は戻せません。**

## 採点 — 1000 点

| checkpoint | 点 | 満たす条件 |
| --- | ---: | --- |
| `manual-hypothesis` | 100 | 対象・証跡・守るべきものがすべて正しい |
| `evidence-backed-plan` | 150 | exact selector で、証跡・事後条件・戻し方が揃った計画 |
| `safe-proposal-review` | 150 | 危ない提案を preview し、**かつ**実行しなかった |
| `threat-containment` | 200 | 侵害されたリソースが動けなくなっている |
| `service-availability` | 200 | 本番 API が応答し続けている |
| `evidence-protected` | 150 | 監査証拠ストアと正常系が残っている |
| `capability-closure` | 50 | 封じ込めた状態で operator capability を失効させた |

減点: 守るべきリソースを含む提案の実行 `-250`、監査証拠の消失 `-300` (最終状態を直しても残る)、
preview なしの実行 1 件につき `-100`、本番停止 1 tick につき `-5`。

封じ込めと可用性は**両方**必要です。全部止めれば封じ込めは満たせますが可用性を落とし、何も
しなければ可用性は保てますが封じ込めが立ちません。

**エージェントの文章は 1 文字も採点しません。** すべての gate はリソースの状態か操作記録という
外部事実を読むので、モデルを差し替えても score は動かず、自信のある誤った要約は 0 点です。

## 遊び方

ポータルに表示されている**アクセス先 URL** を開きます。インシデントの経過、リソースと証跡の
一覧、構造化した計画の入力、提案の差分と承認画面まで、すべてブラウザから辿れます。

MCP 対応クライアント (Kiro、Claude Code、その他) からは `POST /gateway/token` で token を取り、
`POST /gateway/call` で同じ tool を呼べます。ただしそれは遊び方の 1 つであって条件ではありません。
**すべての checkpoint はブラウザだけで完走できます。**

```
GET  /gateway/tools           いま開いているフェーズで呼べる tool
POST /gateway/token           そのフェーズの capability token を発行
POST /gateway/call            { tool, token, sessionId, input }
GET  /posture                 gate・受領証・減点・得点
GET  /audit                   tool 呼び出し、拒否、承認、実行 (読み出しのみ)
```

## コストと安全性

ゼロ。コンテナ 1 つ、loopback のみ、外向き通信なし (`connect` を seccomp で拒否)、非 root、
read-only root filesystem、capability は全て drop。モデルの API key も AWS 資格情報も GitHub
token も要求しません。

## 関連

- `battles/stackstack-gameday` — 段階制 local Docker Battle の先行実装
- `battles/hello-world-battle` — Battle scoring の最小リファレンス
