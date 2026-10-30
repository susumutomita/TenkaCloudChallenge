# 寿命の切れたメモ — php-memory-lifetime-lab

隔離コンテナ内の小さな C プログラムが、解放済みのリクエスト所有ヒープへの参照を
ワーカー側に残す様子を、AddressSanitizer・OBS ログ・任意の gdb 一括表示で観測し、
あらかじめ用意した無害な `record_lab_event` と、保持ポインタを消す修正（正常系は維持）
を独立に確認する入門教材です。

PHP の CVE 再現でも exploit 訓練でもなく、スタック戻り先上書きの演習でもありません。
[`memory-slot-lab`](../memory-slot-lab/)（#923 の安全な JS 模型）を補う実測版で、
Issue #925 の「実メモリ観測」側を担当します。

## 最短で試す

Docker が必要です。この問題ディレクトリで:

```sh
export FLAG_SEED="$(openssl rand -hex 32)"
docker compose -p php-memory-lifetime-lab -f local/docker-compose.yml up --build -d --wait
# Web: http://127.0.0.1:18080
# verify: http://127.0.0.1:18081/verify
docker compose -p php-memory-lifetime-lab -f local/docker-compose.yml down
```

## 問題と参加者の経路

予想 → ASan 観測 →（任意）gdb → クイズ → `record_lab_event` → 修正版の拒否＋正常系。
各ステップの `TC{...}` を Portal の対応チェックへ提出。クラッシュだけでは不合格。

## 隔離と非対象

非 root、読み取り専用ルート（`/tmp` tmpfs）、能力削除、ループバック公開、内部ネットワーク、
CPU/メモリ/PID 上限。実 PHP 攻撃・任意コード・OS コマンド・外部通信・ホスト秘密は対象外。

## PHP との関係（確認済み）

告知: CVE-2026-109618 / 109619。修正コミット（照合済み）
[`3584a98bda0f2c0d367255b046798b0d3a221a19`](https://github.com/php/php-src/commit/3584a98bda0f2c0d367255b046798b0d3a221a19)。
教材の NULL クリアは PHP パッチと同一視しない。未確認の行番号は書かない。

## #923 との分担

memory-slot-lab = JS 模型。本問 = 実 C 観測。どちらも単体で #925 の設計メモ全体を
「完了」とはしないが、本問は受け入れ条件のうち実測・ハーネス・修正回帰を実装する。

## コストと撤収

有料クラウドなし。目安 40 分。Compose の project 名を指定して `down`。永続ボリュームなし。

## 実測と未確認

2026-10-30（Asia/Tokyo）: 問題テスト 9/9、Compose 起動後に Web API と `/verify` 4 チェックを確認。
ASan は heap-use-after-free、gdb 一括も停止位置を表示。`make agent-gate` 通過。
Portal 通しは未実施。実 PHP / CVE 再現 / RCE / AWS は主張しない。

