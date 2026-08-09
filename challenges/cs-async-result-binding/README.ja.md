# 先に返ったのは、どの request の結果だろう

**Track:** `cs-foundations` · **Order:** 30 · **章:** 3. I/Oと並行性 ·
**所要:** 45-75 分 · **配点:** 200 · **前提:** Python の関数・list/dict と基本的な
`async` / `await`

## なぜこの問題を解くのか

5 件の I/O は、それぞれ正しい値を返した。それでも batch は一部の値を別の request ID で保存した。
公開テストが緑なのは、1 request か、入力順に完了する場合しか検査していないからである。

この問題は 1 つの飛躍だけを扱う。

> 各 async 処理が正しいなら、それらを組み合わせた処理も正しい。

これは自動的には成り立たない。組み合わせると、「各 request と後で返る結果の関係を保つ」という新しい
責務が増える。

## この問題で使う用語

- **job** は、一意な `id`、endpoint、query を持つ request の記述。
- **request identity** は、結果または失敗がどの job に属するかを表す直接の関係。
- Python の **Future** は、後で 1 回だけ値または例外が入る箱。
- **入力順**は `jobs` の順、**完了順**は Future が ready になった順。
- **overlap** は、最初の 1 件が完了する前に複数の I/O が開始済みであること。

完了順は request identity ではない。URL も identity ではない。hidden case では、異なる job が同じ
endpoint を共有する。

![完了順が変わっても request identity は Future と一緒に残る](./diagram.svg)

```text
入力順            A -------- value A --------> row A
                  B -- value B ----------------> row B
                  C ----- failure C -----------> row C

完了順            B, C, A        (順序は違っても identity は動かない)
```

## collector の契約

参加者が編集するのは `local/starter/collector.py` 1 ファイルである。

```python
async def collect(jobs, start_io): ...
```

`start_io(job)` は直ちに `asyncio.Future` を返す。最初の結果が release される前に全 job を開始する。
返り値は入力順で、入力 1 件につき正確に 1 row:

```text
成功  {"jobId": job["id"], "ok": true,  "value": value}
失敗  {"jobId": job["id"], "ok": false, "error": str(error)}
```

gate は sleep せず、実 network request もしない。開始を記録してから、seed 由来の明示的な順番で
Future を resolve する。同時完了では 2 個の Future を同じ release group で resolve し、並べ替えに
使える timestamp は存在しない。

## 2 job の観察例

入力が `[A, B]` で、Future B が先に release されたとする。

```text
jobs                         completion iterator
A                            value-from-B
B                            value-from-A
```

`zip(jobs, as_completed(...))` は `(A, value-from-B)` と `(B, value-from-A)` を作る。値だけ見れば
どちらも正常なので、value だけの assertion は通り得る。それでも関連付けは誤りである。Future を待つ
coroutine の中に job を先に束縛すれば、完了後にも関係が残る。

## Participant Portal での進め方

1. 問題を起動し、同じ画面の問題エディタを開く。
2. **証拠を調べる**で `jobs`、`completionTrace`、`storedRows` を比較する。
3. 誤った identity で保存された row index を昇順の JSON array で `audit` に入力する。
4. `collector.py` を読んで編集し、**公開テストを実行**する。出荷時の starter は通る。
5. **提出を準備**する。Portal は `environment` と 4 code 値を作るが、audit の答えは作らない。
6. 値を提出する。分離された verifier が独立した hidden phase で採点する。

完全な経路は `config → inspect → starter → test → prepare → verify` である。

## ローカルでの進め方

```bash
make build
make inspect
make test                 # 公開 suite。出荷時 starter は通る
make test-one ID=ordered  # 名前で公開 check を 1 件選ぶ
make reset
```

作者と CI のみ:

```bash
make reference-test       # author image 内で reference と 7 mutation を検査
```

loopback の 18330 / 18331 で両 API を実行する:

```bash
docker compose -f local/docker-compose.yml up --build
docker compose -f local/docker-compose.yml down
```

cloud resource は使わず、推定 cloud cost は **0 USD**。実 network I/O も行わない。source/harness と
自動 Docker API 検証は validation として記録するが、人間による Participant Portal playtest は
実施記録ができるまで主張しない。

## Checkpoint

| id | 点 | 検査する性質 |
| --- | ---: | --- |
| `environment` | 10 | deploy に結び付いた Future gate の合言葉を読む |
| `audit` | 30 | 誤った request identity で保存された row を特定する |
| `overlap` | 30 | 最初の完了前に必要な I/O をすべて開始する |
| `bind` | 45 | 逆順・部分 permutation でも値の identity を保つ |
| `failure` | 35 | 途中失敗の後も後続 identity をずらさない |
| `generalize` | 50 | 同一 URL、複数 permutation、同時 ready を処理する |

4 code checkpoint は同じ `collector.py` を提出し、それぞれ別の性質を再計測する。逐次化は元の overlap
契約を削除しただけなので、修正として受け入れない。

## この問題が扱わないもの

`eventbridge-delivery-discipline` は messaging boundary を越える delivery ID、retry、business version、
DLQ receipt、replay を扱う。この問題は 1 Python process 内の request、Future、結果の関連付けだけで
終わる。retry や exactly-once delivery は扱わない。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker daemon も image も参加者の
管理下にあります。通常の participant image には hidden checker、reference、mutation suite を入れず、
deploy 用 verifier も別 image に分離します。これは通常経路での誤配を防ぐもので、checkout から author
target を build できる人に対する秘匿境界ではありません。

verifier は提出コードを新しい一時 directory で実行し、timeout、memory、process、file size、出力を
制限します。checkpoint は response が echo した ID だけを加点し、hidden fixture の値を返しません。
両 service は UID 10001、read-only root filesystem、capability drop、loopback 限定 port、外向き経路の
ない network で動きます。

これは誠実な自習を支えます。競技順位・試験・修了判定は**支えません**。それらには participant の
machine 外で管理する verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。
