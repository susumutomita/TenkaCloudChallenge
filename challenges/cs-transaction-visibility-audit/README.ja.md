# どちらも committed。だが、その合計は一度も存在しない

**Track:** `cs-foundations` · **Order:** 20 · **章:** 2. トランザクションと可視性 ·
**所要:** 45-75 分 · **配点:** 200 · **前提:** Python の関数・辞書・for 文を読めること

DB、SQL、並行プログラミングの経験は要らない。ここで使う台帳は、seed から作った immutable な
revision を順番に見せるだけの小さな Python object である。実 thread、待ち時間、network は使わない。

## まず 1 つの事故を見る

ポイント台帳に 2 口座ある。

```text
committed revision 10
  A = 100
  B = 100
  total = 200

report が A を読む       -> 100 @ revision 10

A から B へ 10 移す transaction が commit

committed revision 11
  A = 90
  B = 110
  total = 200

同じ report が B を読む -> 110 @ revision 11
report が返す            -> A=100, B=110, total=210
```

100 も 110 も、読んだ瞬間には committed だった。それでも 210 という合計は revision 10 にも 11 にも
存在しない。**1 回ずつ正しい read を、同じ瞬間の state だと扱った**ことが事故である。

この問題が扱う飛躍はこれ 1 つだけだ。

> 各 read が committed である → 複数 read が同じ committed state を表す

後半は lock、deadlock、retry、idempotency、tenant、SQL 方言を扱わない。

## 用語

- **transaction**: 複数の変更を 1 つの単位として確定する処理。この問題では「A から減らし B へ足す」
  送金を 1 単位にする。
- **commit**: transaction の変更を確定し、新しい revision として読めるようにすること。
- **revision**: ある commit 後の、変更されない台帳 state。番号と全口座残高を持つ。
- **read committed**: 1 回の read が、未確定の値ではなく、その瞬間に確定済みの値を返すこと。
- **snapshot**: 取得した 1 revision を見続ける view。取得後に commit が進んでも、snapshot 自身が読む
  revision は変わらない。
- **visibility**: どの committed revision が reader から見えるか。

## 状況

旧 report service は account を 1 件ずつ `read_committed` で読み、最後に観測した revision を report
全体の revision として返している。各 read は正しい。送金も total を保存する。公開テストも緑である。

監査ログには、旧 service が返した seed 固有の report trace と、実際に commit された state がある。
まず一度も存在しなかった report を特定する。次に、決められた read 順へ候補 transfer を 1 つ置き、
同じ事故を決定論的に再現する。最後に `report.py` を直す。

## 編集する契約

編集するのは `local/starter/report.py` の 1 関数だけである。

```python
def build_report(ledger, account_ids):
    ...
```

戻り値は次の key を**ちょうど**持つ。

```text
{
  "revision": int,
  "balances": {account_id: int, ...},
  "total": int
}
```

`balances` は `account_ids` と同じ ID・順序で作る。`total` は返した balance の合計。`revision` は、その
balance 全部が属する committed revision である。

台帳 API は 2 つだけ覚えればよい。

- `ledger.read_committed(account_id)` は `balance` と `revision` を持つ 1 回の live read を返す。
- `ledger.snapshot()` は `revision` と `read(account_id)` を持つ immutable view を返す。

通常の snapshot は writer を止めない。`exclusive=True` で writer を止める方法は report の契約違反で、
正解には要らない。

## 公開テストは starter を通す

公開例は次だけを含む。

- report 中に commit が無い
- commit が report より前に完了している
- commit が report より後に来る
- 口座が 1 件だけ
- 戻り値の shape と通常の total

どの例も「2 つの row read のあいだに commit」を置かない。したがって starter が緑なのは意図どおりで、
テストが問題の性質をまだ訊いていない証拠である。

## Participant Portal での進め方

1. 問題を起動し、同じページの問題エディタを開く。
2. 「証拠を調べる」を押す。出力は `audit` と `counterexample` の section に分かれている。
3. `audit` は、一度も存在しなかった `reportId` と、その row が観測した 2 revision を JSON で答える。
4. `counterexample` は、commit 前に読む 2 ID、選んだ transfer ID、commit 後に読む 2 ID を JSON で答える。
5. `report.py` を編集し、「公開テストを実行」で shape を確認する。
6. `snapshot` と `transfer` を提出する。どちらも現在の同じ `report.py` を、別の hidden property で採点する。

Portal の prepare API が、直接回答とコードをこの deploy の seed に結び付ける。別の起動で用意した提出値は
再利用できない。

## Checkpoint

| id | 点 | 訊いていること |
| --- | ---: | --- |
| `audit` | 35 | 旧 report のうち、一度も存在しなかった state と観測 revision |
| `counterexample` | 35 | read / commit / read の決定論的な反例 |
| `snapshot` | 80 | 全 row、total、revision を 1 つの非排他的 view に結び付けた `report.py` |
| `transfer` | 50 | 未見の ID・順序・revision gap・複数 commit でも同じ性質を保つ `report.py` |

Hint は checkpoint ごとに 1 つで、開いた checkpoint だけ減点される。4 hint の合計 penalty は 50 点で、
満点 200 の半分を超えない。まず trace を紙に 2 列で書き、それでも詰まった checkpoint だけ開く。

## ローカルでの作者向け確認

```bash
make build
make inspect
make test
make test-one ID=single
make reset
```

作者と CI のみ:

```bash
make reference-test
```

`reference-test` は reference を通した後、次を含む mutation を hidden suite が殺すことを確認する。

- latest-per-row
- row ごとの新規 snapshot
- 最初の live read 後に snapshot
- snapshot を取った後も live read
- balance は正しいが report revision が live
- 公開 total / account ID の固定
- commit があれば report を拒否
- reader-wide writer freeze

## 保証範囲

ローカル mode は self-paced な honor-system verification である。自分の Docker daemon と image を持つ人から
hidden property を秘密にはできない。ここで守る境界は**誤配しないこと**で、通常の participant image は
公開 evidence・公開 test・starter だけを持つ。hidden check、期待値導出、verifier は内部 network 上の別 image
に置き、participant image は `reference/` と `mutation.py` も含まない。author stage は CI 用 material を追加する。

ローカル結果は競技順位・試験・修了判定は**支えません**。

両 service は非 root、read-only root filesystem、capability 全 drop、`no-new-privileges`、bounded memory /
PID で動く。loopback port を公開するのは Workbench だけで、verifier は内部 network からだけ到達できる。
masquerade 無しの publish 専用 bridge を使い、外向き通信を必要としない。fixture、公開・hidden test、採点の
すべては seed から決定論的に作られる。
