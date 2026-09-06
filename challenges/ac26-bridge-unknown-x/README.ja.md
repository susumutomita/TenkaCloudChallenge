# 覆った数で計算し、その限界を試す

> Advanced Cryptography Program 2026 の非公式・独立した companion です。講座や
> 運営者との提携・承認はありません。問題文と実装は独自作成です。質問は講座運営
> ではなく TenkaCloud リポジトリへお願いします。

Track `advanced-cryptography-2026`、order 12、難易度 1、20〜30 分、100 点。

## 参加者の導線

起動して**「証拠を確認」**。紙や電卓、任意の `unknown_x_drill.py` エディタで計算し、
最初の覆った組を提出して「解答済み」を確認します。端末の準備は必須ではありません。
8 欄は、覆う・足す・大きい覆いで比較・覆いの量を記録・戻す・別モデルの余りで候補を
数える・差の漏れを観測・積を展開する、という一続きの実験です。

日英の本文に必要な式と小さい具体例を置き、各欄に「仕組み → 小さい例 → 実画面名の
手順」の 3 ヒントを置きます。ヒント合計 28 点、誤答は 1 回 5 点減点です。最後は
採点外で、共通の覆いを異なる u/v に替え、合計・差・積の何が変わるか考えます。

任意の公開テストは、まず公開された小さい例を検査し、後半に現在の公開入力に対する
参加者自身の計算値を表示します。後半の表示はその値の採点ではありません。8 欄とも
手入力の値を採点し、ソースの提出や公開テスト PASS だけでは加点しません。

| Checkpoint | 配点 | 採点する証拠 |
|---|---:|---|
| covered | 10 | 覆った 2 数の順序付きの組 |
| sum-covered | 10 | その整数の合計 |
| huge | 15 | 大きい覆いでの 2 式の差 |
| held | 10 | 返事と覆いの総量、この順の組 |
| recover | 10 | 覆いを 2 個外した元の合計 |
| guesses | 15 | 余りの全範囲での候補数 |
| gap | 15 | 覆った 2 数の符号付きの差 |
| product | 15 | 積、x² 以外の項、その差 |

候補実験は双方の候補に `0..n−1` 全体を許す別モデルです。生成器の狭い整数範囲の
秘密性を証明しません。候補が残ることと観測確率が同じことも区別します。積の実験は
足し算の補正 `2*x` をそのまま使えないことを示し、x² だけを除いても `(a+b)*x` が
残ると説明します。乗算不可能性やブートストラップの導出とは主張しません。別の
実験でも同じ数値の正答になる欄があるため、他人の数値が必ず不正解とも言いません。

## 実行構成と採点権限

Compose は参加者 Workbench と、host に公開しない verifier を作ります。`fixtures/`
と期待値の導出は verifier image にだけ入り、`reference/` と `mutation.py` は author
stage の追加です。verifier が実行ごとの `FLAG_SEED` を受け、`/public` から公開入力
だけを返します。

Workbench の container 環境には fixture seed を渡しません。PID 1 や healthcheck も
同じです。Python supervisor は待受開始前に自身の process を保護し、固定した内部
経路から署名用の派生 key と公開入力の snapshot を取得します。公開 API は key を
返しません。既存の `tcw1` 形式で値を小問・実行に結び付け、verifier は値自体も比較
します。未署名・改変・別欄・別実行の署名済み提出は拒否します。組の各要素も整数
として正確に比較し、小数を切り捨てて正答にしません。

**「公開テストを実行」**の子 process には公開データだけを渡します。固定 Linux
image の libseccomp で通信と、保護した supervisor の読取り・妨害を制限します。
制限の導入に失敗した場合は実行を中止します。起動時に継承 descriptor を閉じ、終了・
timeout 時に process group を停止します。これは追加の process 制限であり、任意の
kernel 攻撃に対する完全な sandbox の主張ではありません。

Docker を管理する本人に対しては自習用です。その人は verifier image や stack を
調べて変更できるので、管理者自身を相手にした競技順位・試験・修了認定の権限には
なりません。Workbench launcher を経由しない CLI 直接実行には、この process 制限は
適用しません。

host port は Workbench の `127.0.0.1:18140` だけで、verifier にはありません。両方
non-root、read-only root filesystem、capability なし、no-new-privileges、メモリ・
PID・CPU 制限付きです。AWS resource や cloud account は不要です。ローカル Docker
の CPU、メモリ、image、disk は停止や image 削除まで使用します。

## 作問者の検証と片付け

問題ディレクトリから、作問専用の synthetic `FLAG_SEED` で実行します。

```sh
make reference-test
make test
make inspect
make verifier-down
```

`reference-test` は既存の 25 mutation に加え、bootstrap・厳密な整数回答・Linux の
process 境界を author image で検査します。`test` と `inspect` は非公開 verifier から
公開入力を取得します。starter は埋めるまで意図的に失敗します。実 Workbench の境界
検証は専用 loopback URL を `UNKNOWN_X_WORKBENCH_URL` に指定し、
`local/tests/hidden/test_isolation.py` を実行します。seed 検査は有無の boolean だけを
返します。

リポジトリ root の `make install && make agent-gate` は catalog 検査で、HTTP や runtime
境界の証拠ではありません。読者の発見、講義・ノートの根拠、参加者経路の確認は
[local/tests/hidden/READER.md](local/tests/hidden/READER.md) に記録します。片付けは自分の
Compose project だけを対象にします。`make verifier-down` はこの問題の default
project を停止します。release、cloud deploy、共有環境の変更は不要です。
