## 前提

足し算・掛け算・割った余りと、Pythonの変数・if・for・関数・リスト・辞書を使います。必要な暗号の言葉とAPIは下で説明します。

## 最初の操作とゴール

あなたは「この口座の上限を破る入力を知っている」と伝えるプログラムの担当です。**別の口座の記録が証拠として使われる不具合**を、入力と出力の結び付けで防ぎます。

**「起動」→「証拠を確認」→ `collisionPair` の2口座を見る → `guest.py` の `encode_statement` を編集 →「公開テストを実行」→ `encoding` を提出。** 全8項目は同じファイルを採点します。直接回答欄はありません。公開テストは形と基本動作、各提出の正解がその項目の完了です。不正解15点、ヒントは各2点（8項目×3段=48点）。

```text
公開: どの口座・プログラム・計算規則・主張か ─┐
秘密: 攻撃に使う数量 ───────────────────┤ 自分で実行
                                            ↓
                             公開記録を対象の全条件に結び付ける
                                            ↓
                                  相手が期待する対象と照合
```

## 本物のzkVMと、この教材

**zkVM**はプログラムの実行を証明する仕組み、**guest**はその中で動かすプログラム、**host**は外側から入力を渡す側です。本物では、証明を期待するプログラムに対して検証します。プログラムを識別できない技術という意味ではありません。アプリ側は「どの口座について、何を主張したか」も公開データへ結び付けます。[RISC ZeroのReceipt仕様](https://docs.rs/risc0-zkvm/latest/risc0_zkvm/struct.Receipt.html)

この問題はPythonで**入力・出力の約束だけ**を実装します。証明の生成・暗号学的検証は行いません。教材のreceiptは書き換えられる辞書で、実際の証明として信用してはいけません。

## 使う言葉とデータ

| 言葉 | この問題での意味 |
|---|---|
| statement | 公開の主張。下の6項目を持つ辞書 |
| witness | 秘密の入力。quantity（数量）、aux（参考の計算結果）、search（探索した数量の列）の辞書 |
| image | プログラムのデータ。実行する `body` のバイト列と外側のラベル |
| digest / commit | データを決まった手順で短い文字列にする値と支給関数。等しい対象に等しい値を付ける |
| journal | guestが外へ渡す公開記録。何を出すかを5番で決める |
| receipt | そのjournalを入れた `{"journal": ...}`。この教材では暗号の証明部分を省略 |
| profile / semantics | 幅と桁溢れの扱いを決めた計算規則 |
| transcript / disclosure | 入力時の公開記録 / 実行後の6つの出口の内容 |
| encoding / 正準符号化 | 同じデータには同じ書き方を使い、異なるデータを区別できるバイト列にすること |

`bytes`は0〜255の数を並べたデータです。文字をUTF-8という共通の規則でbytesにするには `text.encode("utf-8")`。`b""`は空、`+`は連結、`len(payload)`はバイト数です。整数は `n.to_bytes(幅, "big")` で大きい桁から指定バイト数にします。例：`(3).to_bytes(2,"big")` は `[0,3]`。`tuple`は並び、`None`は該当なし、`raise ValueError("理由")`は不正な入力を拒む方法です。

### statementの無料の条件

項目は `STATEMENT_FIELDS` の順で domain / guestVersion / imageDigest / semantics / claim / params、余分・不足は拒否します。

- domainはこの約束の名前（`DOMAINS`）、guestVersionはguestの版（`GUEST_VERSIONS`）。
- semanticsは `SEMANTICS` のキー、claimは `CLAIMS`（上限超過が掛け算 `mul` / 足し算 `add` のどちらで起きたか）。これらは文字列です。
- imageDigestは `DIGEST_HEX_LENGTH` 文字の文字列で、各文字は `0123456789abcdef`。
- paramsは `PARAM_NAMES` の price / spent / budget だけ。全てTrue/False以外の整数で、`0 < price <= max`、`0 <= spent < budget <= max`。maxはstatement自身のprofileから読みます。

`SEMANTICS[statement["semantics"]]` は width（ビット数）、modulus（`2**width`）、max（modulus−1）、overflowを持ちます。ビットは0/1を1個保存する桁。3ビットなら0〜7、8で一周します。この3ビットは小例で、本番の幅は画面から読みます。

witnessの形の小例です。`aux`は参考値で、4番はこの値を信用せず数量から計算します。`search`はリストでもtupleでも構いません。全ての整数は0〜profileのmax（bool不可）です。

```python
{"quantity": 3, "aux": {"machineCost": 1, "machineTotal": 2}, "search": [2, 3]}
```

`image["body"]`は `bytes` または `bytearray`（書き換え可能なbytes）を許します。どちらも `bytes(body)` で同じbytesに揃えてからdigestを作ります。JSON上の16進文字列は支給の読み込み側でbytesに直して渡されます。

## 支給API

`guest.py` 冒頭にimport済みです。定数は固定値を書き写さずその名前を使います。

| API | 操作 |
|---|---|
| `commit(payload, domain)` | bytesと用途の名前からdigest文字列。image用とstatement用の定数は別 |
| `decode_program(image["body"])` | 命令名のtuple。不正なbodyはValueError |
| `is_well_formed(witness, profile)` | witnessの3項目と数の範囲が正しいか。判定を支給 |
| `claim_site(statement["claim"])` | 求める桁溢れの場所 `mul` / `add` |
| `env.public(name,value)` / `env.public_inputs()` | 公開入力を渡す / その辞書を読む |
| `env.write_private(witness)` / `env.read_private()` | 秘密入力を1回渡す / 読む |
| `env.transcript()` / `env.writes()` | 公開された入力記録 / 秘密入力を書いた回数 |
| `env.variable`, `env.note` | 環境変数・作業メモ。記録に残るので秘密を入れない |
| `env.hints()` | hostの参考値。正しいとは限らず計算結果として使わない |

「証拠を確認」は今回のstatement、profile、imageとその違い、口座の衝突例、公開できる名前を表示します。公開テストはそれらを各関数へ渡します。`print(statement)` を入れてテストすれば、実際に渡された形も読めます。

## 1〜3：対象を固定し、入力を分ける

**1. encoding — `encode_statement(statement) -> bytes`**

`"1"+"23"` と `"12"+"3"` は同じ `"123"`。区切りを失うと違う口座が同じ主張になります。次の書式を使います。

```text
frame(payload) = len(payload).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + payload
text(s)        = frame(s.encode("utf-8"))
integer(n)     = frame(n.to_bytes(INTEGER_BYTES, BYTE_ORDER))
params         = frame(各PARAM_NAMESを順に text(名前) + integer(値) として連結)
statement      = STATEMENT_FIELDS順に、paramsは上の塊、他はtext(値)として連結
```

これらのframe/text/integerは書式の名前です。自分の小関数にしても構いません。定数は長さ4バイト、整数8バイト、順序big。例：`frame(b"ab")`は `[0,0,0,2,97,98]`。paramsは内側の名前・値に加えて、全体にも長さを付けます。辞書に入れた順ではなく指定順で書き、不正なstatementはValueErrorです。

**2. identity — `image_digest(image) -> str`**

bodyをdecodeして実行できる形式か確認し、`commit(bytes(body), IMAGE_COMMITMENT_DOMAIN)`を返します。外側のimageId/sourcePath/buildIdは使いません。この教材のbodyにはビルド印も含むため、印のバイトが変わればdigestも変わります。外側のファイル名だけが変われば同じです。本物のzkVMのimage形式を一般化した規則ではありません。不正body・bodyがない入力はValueError。

**3. ingestion — `guest_input(env,statement,witness) -> None`**

statementと `is_well_formed(witness,profile)`を確認してから、公開入力に6項目全部をそのまま渡し、秘密の3項目は全体を `write_private` で1回渡します。例：quantity=3はprivateへ。`env.note`へ3を書けば記録に漏れます。auxやsearchも秘密です。不正入力は、何も書く前にValueErrorです。

## 4：hostの答えを使わず実行する

**reexec — `run_guest(image,env) -> dict`**。statementとwitnessを読んで検査し、image_digestがstatementのimageDigestと違えば実行前にValueError。命令はbodyからdecodeします。

| 命令 | accumulator（計算途中の数）への操作 |
|---|---|
| load-quantity | quantityを入れる |
| mul-price | 今の数×price |
| add-spent | 今の数+spent |
| guard-le / guard-lt | 今の数がbudget以下 / 未満ならaccepted=True |

各算術命令でmaxを超えたとき：wrappingはmodulusで割った余りへ変え場所を記録、saturatingはmaxへ変え、checkedはtrapped=Trueで停止。停止を起こした命令はstepsに数えません。それ以外はloadとguardも1命令として数えます。掛け算を処理した結果に、次の足し算を適用します。

小例：3ビット、price=3、spent=1、budget=4、quantity=3。掛け算9→余り1、足し算1+1=2なので機械は許可。しかし普通の整数では1+3×3=10>4です。

```text
violated   = spent + price * quantity > budget        # 余りにしない
claimResult = accepted AND violated AND 求めた場所がwrappedにある
```

返すのは `RUN_FIELDS` の8項目：imageDigest、steps（完了命令数）、programSteps（bodyの**総命令数**）、accepted、violated、wrapped（重複なし・整列した場所のtuple）、trapped、claimResult。4つの判断はbool、2つの命令数はTrue/False以外の整数です。上の例はsteps=programSteps=4、wrapped=("mul",)、mulの主張はTrue。checkedならsteps=1で停止しますがprogramSteps=4のままです。aux・search・hostのhintsは結果の根拠にしません。

## 5〜6：公開記録と、別の対象への使い回し

**5. journal — `seal_journal(statement,run) -> dict`**。5項目ちょうどを返します。

| 項目 | 値 |
|---|---|
| statementDigest | `commit(encode_statement(statement), STATEMENT_COMMITMENT_DOMAIN)` |
| imageDigest / guestVersion | statementの同名項目 |
| claimResult | runのboolをそのまま |
| measurements | `{"steps": run["programSteps"]}` |

公開するのは総命令数です。上の小例はwrappingでもcheckedでも4。途中で何命令進んだかは秘密の数量によるため公開しません。

不正statement、runの項目不足/余分、4判断の非bool、命令数の非整数や `0 <= steps <= programSteps` を外れるもの、programSteps<1、wrappedが許可された場所の重複なし整列列でないもの、imageDigestの不一致はValueError。run自体は4番で計算する内部記録です。

**6. replay — `accept_receipt(receipt,statement) -> bool`**。不正な形でも例外を出さずFalse。

receiptはjournalだけ、journalは上の5項目だけ、measurementsはstepsだけの辞書で値は1以上の整数（bool不可）。statementを検査し、statementDigestを全statementから計算し直して一致、imageDigestとguestVersionも一致、claimResultが `True` そのものなら受理します。例：priceだけ変わった別の口座はstatementDigestが変わるので拒否。

この関数は暗号の封印を確認しません。期待するimageと出力が本物の証明に結び付く検査は、実際のzkVMで別途必要です。image引数を持たないこの関数だけではstepsの実際の長さも検証できません。

## 7〜8：漏えいと組み合わせを調べる

**7. privacy — `leak_report(disclosure,statement,image) -> tuple`**。disclosureは属性を持つオブジェクトです。

| 属性 | 形 |
|---|---|
| `.journal` | 項目名と値の辞書 |
| `.stdout`, `.stderr`, `.trace`, `.temp` | `{"label": 見出し, "values": 辞書}`の列。標準出力・エラー出力・実行記録・一時ファイル |
| `.error` | Noneまたは `{"message": 見出し, "values": 辞書}` |

journalと各valuesを調べ、値が辞書なら**その直下1段の項目も**同じ出口で調べます。見出し文字列は対象外。違反は①名前がPUBLIC_NAMESにない、②PARAM_NAMESなのにstatementのその整数と型・値が違う、③MEASUREMENT_NAMESなのに `len(decode_program(body))` と型・値が違うもの。全 `(出口,名前)` を重複なく整列して返します。無違反は `()`。

例：公開spent=1なのに `stdout`のvaluesが `{"spent":3}` → `(("stdout","spent"),)`。許可名でも秘密の計算結果を入れてはいけません。下の階層全て・見出し・タイミングまで安全だと証明する検査ではありません。

**8. transfer。** 新しい関数は増やしません。変わった幅・口座・主張・プログラム・版で7関数を確かめ、入力→実行→journal→照合をつなぎます。単体で通っても、渡す形や対象が境界で食い違えば失敗します。数値やidを見本に固定せず、同じ対象は受理・別の対象は拒否・失敗時も秘密を公開しないことが終点です。
