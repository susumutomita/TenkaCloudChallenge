# PXE 起動中の ICMP を疑え — pxe-icmp-oob

EDK II の PXE ICMP エラーバッファ溢れ（CVE-2026-97631）の「壊れたコピー」だけを、安全な
プロセス内模型で学ぶ問題です。本物の UEFI / Secure Boot / TPM / 実パケットは動きません。
固定 504 バイトの受信バッファと、書き込み位置を断片の累計長で進めるコピーを再現します。
実悪用には PXE 起動の数秒間・そのあいだの LAN 到達・機種ごとの番地合わせが要りますが、
このラボにはありません。送ったバイト列はリクエスト終了とともに捨てられます。

## ローカル実行

この問題ディレクトリで、Node.js 22 以上・依存パッケージなし:

```sh
node --test tests/*.test.mjs
EVALUATOR_URL=http://127.0.0.1:8082 node local/app/server.mjs
# 別ターミナル:
FLAG_SEED=local-fixture-only node local/verify/server.mjs
```

`http://127.0.0.1:8080` を開き、`/spec` を読み、`POST /icmp` に断片を送り、クイズに答えます。
Ctrl+C で停止。`FLAG_SEED` は TenkaCloud が `secretEnv` で注入する実行ごとの種で、採点側だけに渡します。表面は元の入力だけを内部ポート 8082 へ転送し、判定・合言葉導出は
秘密を持つ採点側で実行します。送信前に採点側を起動してください。表面から計算済み判定や
種を指定することはできません。公開する採点ポート 8081 は `/verify` のみを扱います。

## 物語・参加者ルート・期待動作

架空の **NetBoot lab / EDK-toy** の受け取り口を調べます。最初の一手は `/spec` を開き
`icmpErrorSize`（504）を確認すること。その後 ICMP エラー断片（hex または base64）を送り、
`writes[].offset`・`overflowedBuffer`・`guardIntact`・`handlerTag` を観察します。チェック
ポイントは 5 つ（合計 100 点・Easy）:

| id | 点 | 根拠 |
| --- | --- | --- |
| buffer-shape | 15 | ちょうど 504 バイトの断片 1 つ |
| cumulative-advance | 25 | 合計 ≤ 504 なのに箱の外へ着地する複数断片 |
| overwrite-secret | 30 | 隣接の `handlerTag` を `debug` に書き換え |
| boot-scope | 15 | クイズ: ディスク起動が範囲外なのは PXE 経路だけのコピーだから |
| impact-class | 15 | クイズ: ハング＝DoS、制御の Steer＝コード実行クラス |

採点は `multi-verify`。Portal が `{checkpointId, submission}` を loopback の verifier に送り、
応答は `checkpointId` をエコーし `{correct, message}` を返します（点数や正解フラグは含まない）。

## 構成

- `local/app/model.mjs` — 公開模型・入力デコード・クイズの問題と選択肢。
- `local/verify/grading.mjs` — 非公開の判定条件・クイズ正解・合言葉導出。
- `local/app/server.mjs` + `index.html` — 参加者表面（`/`・`/spec`・`/icmp`・`/quiz`）。
- `local/verify/server.mjs` — 8081 の `/verify` と内部専用 8082 の入力評価。秘密と採点コードは表面イメージに含めない。
- `tests/*.test.mjs` — 模型の性質と、HTTP で 5 チェックポイントを解く結合試験。

## 安全境界と CVE-2026-97631 との関係

| 本物 | このラボ |
| --- | --- |
| NetworkPkg/UefiPxeBcDxe の固定 ~504 バイト `Mode.IcmpError` | 同じサイズの玩具構造 |
| 壊れた境界検査 + 累計での宛先進み | `collectIcmpError` で再現 |
| OS / Secure Boot 前の ring 0、TPM 到達もあり得る | 権限なしの Node プロセス |
| PXE 窓 + LAN ICMP + 機種ごとの Steer が必要 | 範囲外。クイズで理由を学ぶ |
| 対策はファームウェア更新 | 文書化のみ。ここには直す対象がない |

本物のファームウェアへの攻撃手順は含みません。ベンダーパッチの検証もしません。

## コンテナとプラットフォーム連携

```sh
FLAG_SEED=local-fixture-only docker compose -p pxe-icmp-oob -f local/docker-compose.yml up --build -d --wait
# Web: http://127.0.0.1:18080 ; verifier: http://127.0.0.1:18081/verify
FLAG_SEED=local-fixture-only docker compose -p pxe-icmp-oob -f local/docker-compose.yml down
```

ポートは `127.0.0.1` にバインド。非 root・read-only・`cap_drop: ALL`・ヘルスチェック付き。
サービス間は内部 Compose ネットワークを使い、8082 はホストへ公開しません。表面は 3 秒で
評価待ちを打ち切り、採点側が使えなければ 503 を返します。
Docker ホストでのスモークが通るまで `status: draft` のままにします。

## コストのある資源と解体

なし。ローカル Docker のみ。AWS 等は使いません。解体は `docker compose … down`。

## ローカル検証の主張

- `node --test tests/defensive*.test.mjs`: 防御・静的境界・通常入力の HTTP 6 件が成功。
- 既存模型テストのうち、合言葉導出・範囲内 504 バイトの充填・クイズ採点の 3 件が成功。
- `make agent-gate`: カタログ検証と root 契約テストが成功。
- 非空の範囲外書き込みを行う既存模型テストと、全 5 問を解く HTTP 試験は今回再実行していません。
  import と起動方法だけを新しい分離構成に合わせています。
- Docker の build/run — 執筆環境に Docker が無いため **未検証**。`draft` を維持。
