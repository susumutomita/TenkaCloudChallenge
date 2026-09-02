# 応答が消えた。再送で同じ支払いを増やさない

**Track:** `cs-foundations` · **Order:** 50 · **章:** 5. HTTP/TLSプロトコル境界 ·
**所要:** 45–75分 · **配点:** 200 · **実行環境:** Python標準ライブラリ + SQLite

## なぜ必要か

HTTP timeoutは、serverが何もしなかったことを意味しない。clientが時間内に応答を受け取れなかったことだけを
意味する。serverは支払いをcommitした後で、応答だけを失ったかもしれない。考えずに再送すると、1回の購入が
2件の請求になる。

このlabは、証拠が答えるべき問い1つから始まる。timeoutしか持っていないclientは、serverについて何を言い切れるか。

修復するのは同期HTTP操作1つである。これはexactly-once transportではない。要求と応答は0回、1回、複数回
配送され得る。保証する範囲はもっと狭い。同じ論理操作のvalidな試行が作る**業務副作用をat-most-once**にし、
retryが保存済み結果を回収できるようにする。

```mermaid
sequenceDiagram
    participant C as Client
    participant H as HTTP handler
    participant D as SQLite
    C->>H: POST + Idempotency-Key K
    H->>D: transaction: ledger行 + receipt(K, fingerprint, status, body)
    D-->>H: commit
    H--xC: 応答が消失
    C->>H: 同じK + 同じrequest
    H->>D: durable receipt Kを読む
    D-->>H: 元のstatusとbody
    H-->>C: exact replay; ledger行は増えない
```

## 証拠とworked example

deploy固有traceのattempt 1には、次の順序が記録されている。

1. requestを受信した。
2. ledger行をcommitした。
3. clientが受け取る前にresponseが消えた。

壊れたgatewayは、同じkeyとrequestを再送すると別の行をcommitし、2件目のchargeを返す。traceにはstep 3でclientが
観測したもの (timeout) も記録されている。それがその瞬間にclientが持っていたすべてで、step 1–2はあとから調べたserver側
の記録である。`uncertain` checkpointは、clientが自分の観測から言い切れることを問う。`audit`のledgerには、この2件の
commitがtraceと同じchargeIdで、commit順に、無関係な行の間に並ぶ。

最初の要求がkey `pay:example`、body
`{"account":"acct-7","amount":4200,"memo":"book"}`だとする。正しい初回応答は例えば次になる。

```json
{"status":201,"body":{"chargeId":"ch_1","account":"acct-7","amount":4200,"memo":"book"}}
```

同じkeyと同じ論理bodyのretryは、`ch_1`を含むstatus/bodyを完全に再生する。key `pay:example`のまま
`amount: 4300`へ変えたretryは次を返す。

```json
{"status":409,"body":{"error":"idempotency_conflict"}}
```

どちらのretryもledger行を増やさない。

## Participant-visible contract

`idempotency.py`を編集し、次を定義する。

```python
handle_request(db_path, idempotency_key, request) -> {"status": int, "body": dict}
```

契約と判定順は次で完結している。

1. `idempotency_key`は空でない64文字以下のstringで、ASCII英数字と`.`、`_`、`:`、`-`だけを使う。
   違反時はstatus 400、`{"error":"invalid_idempotency_key"}`を返す。
2. `request`は`account`、`amount`、任意の`memo`だけを持つobjectとする。`account`は空でない80文字以下の
   string。`amount`はbooleanではない1以上1,000,000以下のinteger。`memo`のdefaultは`""`で、120文字
   以下のstring。違反時はstatus 400、`{"error":"invalid_request"}`を返す。
3. keyを予約する前にvalidationする。400はledger行もreceiptも作らず、後のvalid requestが同じkeyを使える。
4. valid requestを`account`、`amount`、`memo`の3項目に正規化し、keyをsortしたcompact JSONとしてUTF-8
   encodeし、SHA-256のhex digestをrequest fingerprintにする。必要なmoduleはPython標準ライブラリにある。
5. receiptが無いkeyでは、1つのSQLite transaction内でledger行とdurable receiptを作る。receiptにはkey、
   fingerprint、response status、serialized response bodyを保存する。
6. validな初回callはstatus 201を返す。bodyは`chargeId`、`account`、`amount`、`memo`の4項目だけである。
   charge idも保存済みbodyの一部なので安定する。
7. 同じkeyかつ同じfingerprintは、最初に保存したstatus/bodyを完全に返す。ledger行を増やさない。
8. 同じkeyかつ異なるvalid fingerprintはstatus 409、`{"error":"idempotency_conflict"}`を返す。
   ledgerもreceiptも変更しない。
9. 同じkey/fingerprintへのconcurrentな初回試行は、ledger行1件、receipt 1件へ直列化する。checkして後から
   insertするだけではatomicではなく、試行は同じprogramの別のcopy (worker) が処理し得るので、process内のlockや
   dictionaryも直列化にならない。本文は道具を2つ与える。receiptを読む前に`BEGIN IMMEDIATE`で書く番を取るか、
   key列の`PRIMARY KEY`で負けた側に`sqlite3.IntegrityError`を送出させ、負けた側は自分のtransactionをrollback
   してから読み直す。
10. receiptはhandler/moduleの再生成を越えて残る。module-level dictionaryはdurableではない。

判定順はinvalid key → invalid request → existing key comparison → createである。SQLiteのoperational failureは
raiseしてよいが、成功receiptや2件目の業務副作用へ変換してはならない。

## 意図的に不十分なpublic test

出荷starterはpublic testをすべて通る。single success、malformed input、異なる2つのkey、output shapeを調べるが、
同じkeyをretryしない。

hidden phaseは性質を1段ずつ足す。

- `replay`: 同じkey + canonical-equivalent bodyがexact replayになり、副作用は1件。
- `bind`: 異なるvalid bodyは409で、validationはkeyを消費しない。
- `generalize`: concurrentな初回試行 (moduleのcopy 2つに分けた8 thread。次節の決定論的interleaveで駆動)、別の
  keyを混ぜる回、handler再生成でも、keyごとの副作用と保存済み応答は1つ。

このpublic-hidden gapが演習である。example testのgreenはprotocol invariantを証明しない。

## 並行判定の仕組み

以前の`generalize` phaseは、8 threadをbarrierで揃えて起動し、interleaveをOSに任せていた。それは起きなかった。
素朴なcheck-then-insertは読みと挿入を1 ms未満で終えるため毎回通り、規則9が警告する反パターンを採点は実際には
試していなかった。

hidden checkerは今、submissionをimportする前に`sqlite3.connect`の周りにhookを入れる (`from sqlite3 import
connect`も対象)。concurrent roundの間、参加者threadはSELECTの結果をfetchした直後 — check-then-insertが「無い」と
決めた瞬間 — に止まり、まだ到着し得る全threadが到着したとき、または残りがSQLiteの中で待たされていて50 msの
stallが過ぎたときに、止まっていたthreadが一斉に解放される。したがって正しい`BEGIN IMMEDIATE`は直列化された
読み1回につき1 stallを払うだけで、check-then-insertは8 thread全部が「無い」を読んでから挿入する。試行は参加者
moduleの独立したcopy 2つ (同じfileを`importlib`で再実行) に分けて流す。gatewayがworker processに要求を分ける
のと同じで、module-levelの`threading.Lock`では直列化にならない。2回目のroundは2つのkeyを混ぜ、restart round
は再送の前にmoduleを再実行する。失敗messageは性質 (keyごとに1行、応答の一致、receipt 1件、例外なし) を名指し、
例外のclass名だけをechoする。hiddenのkeyやpayloadは含まない。

作者のcheckoutで、in-processとverifier subprocessの両方で各10回ずつ確認した。reference、starterのlegacy
isolation modeでの教科書どおりの`BEGIN IMMEDIATE`、`PRIMARY KEY` + `IntegrityError`方式、`with connection:`
形は10/10通過。素朴なcheck-then-insert、process内lock、読みの後ろに置いた`BEGIN IMMEDIATE`、deferred `BEGIN`、
負けた側のledger行が残る制約方式、例外を処理しない制約方式は10/10落ちる。同じ実行をsuite 4本並列でCPUに負荷を
かけて繰り返した。local modeの他の部分と同じくhonor-systemである。hookはverifier imageにあり、Dockerを管理する
参加者は読める。

## Participant Portalでの進め方

1. 問題を起動する。問題ページにeditorと証拠操作が表示される。
2. 「証拠を調べる」で、codeを触る前にfirst-attempt traceを読む。
3. public testを実行し、`idempotency.py`を点検する。
4. このdeployの証拠からdirect-answer欄を埋める。
5. checkpointを提出する。Portalは現在のeditor fileを`/api/prepare`と`/verify`へ送る。

Workbenchとhidden verifierは別containerである。hostへ公開されるのはWorkbenchだけで、
`127.0.0.1:18350`からCompose-internal network上のverifierへ転送する。

## ローカルでの進め方

次のcommandにはDockerを使えるhost terminalが必要である。

```bash
make inspect          # seed由来のresponse-drop traceとledger
make test             # public test; starterは通る
make test-one ID=...  # test名の部分一致で1件
make up               # Workbench: http://127.0.0.1:18350
make down
```

作者とCIだけが使う。

```bash
make reference-test   # reference + hidden properties + 13 mutations kill + verifier near-miss check
```

## Checkpoint

| id | points | 訊いていること |
| --- | ---: | --- |
| `environment` | 15 | このdeployのWorkbench合言葉を写す |
| `uncertain` | 20 | timeoutした初回試行を`[requestId, "unknown"]`で答える |
| `audit` | 30 | 1つの論理操作を二重計上した後発ledger indexを挙げる |
| `replay` | 35 | durableなsame-key/same-request exact replayを実装する |
| `bind` | 40 | keyをfingerprintへ結び、別requestを409にする |
| `generalize` | 60 | program copy 2つに分けたinterleave同時試行とhandler再生成でも、keyごとの副作用を1件に保つ |

## 保証範囲

local modeはself-pacedなhonor-system verificationである。participantはmachine、Docker daemon、imageを管理する。
通常のparticipant imageはhidden test、reference、mutationを含まず、
hidden verifierは別imageである。それでもDockerを管理する人はauthor stageをbuildして中を読める。この分離は誤配を
防ぎ、悪意あるhost ownerから秘匿するものではない。submissionには時間・memory・process・output capをかける。
containerはnon-root、read-only、privilege無しで動き、masqueradeされたoutbound networkを持たない。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

HTTPをexactly onceにしたのではない。1つの論理操作を回収可能にした。validな初回commit後のretryはdurable receiptを
再生するか、key/payload conflictを明示する。これは証拠に支えられる範囲を越えない、正確で役に立つ保証である。
