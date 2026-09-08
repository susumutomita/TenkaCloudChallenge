## 前提

正負の数の足し算・引き算・割り算と、Pythonの関数・リスト・dictを使います。余りの書き方と必要なAPIはここで説明します。

## あなたの役割と最初の提出

あなたは、各人の持ち数を相手に渡さず、合計だけを計算するプログラムの担当です。最後には、そのプログラムの欠陥を見つける検査も自作します。これは秘密計算（複数人が入力を隠して共同で計算する方法）の小さな実験です。

ここでthreshold（しきい値）は、協力して自分たちの入力を持ち寄ると、合計から残り一人の入力が分かる人数の境目です。人数nに対してn−1人が合計から自分たちの入力を引くと、残り一人の値になります。

「起動」→「問題エディタ」→「証拠を確認」で、setting（人数・割る数・入力）と vocabulary（性質の名前）を見ます。まず capstone.py の scope だけ編集してください。PROVIDED をリストにしたものを claims、NOT_PROVIDED をリストにしたものを non_goals にし、threshold は setting.parties−1、parameters は setting.as_dict() を返します。「scope の提出」で解答済みになれば最初の到達点です。なぜ二つを保証しないのか、下の表と対応させます。

|名前|この教材での意味|この構成|
|---|---|---|
|correctness|約束どおり動けば合計が正しい|確認する|
|privacy|指定した観測記録で二つの入力例を区別できない|小さい実験で確認する|
|soundness|参加者の入力の嘘を発見する|入力を照合しないので与えない|
|availability|一人が応答しなくても完了する|全員を待つので与えない|

同じファイルを8項目で採点します。公開テストの test_the_scope_uses_the_known_vocabulary は最初の形の確認です。未実装の後続テストの FAIL はこの段階では構いません。「公開テストを実行」は検算、各項目の「提出」は採点で、不正解の提出は15点減点です。全8項目の解答済みが完了です。

## 持ち数 → 分ける → 受信した数を足す → 合計

割った余りを `%` と書きます。例：−1 を7で割った余りは6、Pythonで `(-1)%7 == 6`。以降の数は0〜p−1に直します。pを割る数、nを人数とします。番号は0からn−1です。シェアは、足して余りを取ると元の数になる取り分です。

各人iが入力vを分ける一般式は、最初のn−1個を与えられた乱数rから取り、最後を `(v-sum(r))%p` とします。乱数はどの値も同じ確率で選ぶ数です。この実験では選ばれた数の並びを引数で渡します。勝手に random を呼びません。

```text
p=7、3人、入力が 3,4,2
送信者 ＼ 受信者     0    1    2
0（入力3、乱数1,2）  1    2    0   ← (3−1−2)%7=0
1（入力4、乱数2,3）  2    3    6   ← (4−2−3)%7=6
2（入力2、乱数4,1）  4    1    4   ← (2−4−1)%7=4
受信者ごとの合計     0    6    3   ← 各列を足し7の余り
最後の出力 (0+6+3)%7 = 2 = (3+4+2)%7
```

行iの列jを s[i][j] と書くと、公開する小計は t[j]=(s[0][j]+…+s[n−1][j])%p、output=(t[0]+…+t[n−1])%p。入力の和と一致するのは、同じ取り分を行ごとに足しても列ごとに足しても総和が変わらないからです。表は頭の整理用で、行列の予備知識は不要です。

1回目の通信で取り分を送信、2回目で小計を全員に公開します。rounds はこの待ち合わせ回数で2です。自分宛ても記録するので messages はn*n件、小計はn件。ただし measure ではこの公式を固定して返すのでなく、実際の記録を数えます。

## 支給APIと入力の約束

starterのimportは用意済みです。自作の補助関数も同じ capstone.py に書けます。Setting は設定をまとめたオブジェクトで、`setting.parties` のように値を読みます。入力は正しい設定（n≥2、pは素数、inputsは長さnの整数tuple、各値は0〜p−1）です。bool は整数として扱いません。型名 tuple は `(1,2)` のような並び、dict は名前付きの値です。

|API|返すもの・使い方|
|---|---|
|Setting(parties,modulus,inputs)|設定を作る。例 Setting(3,7,(3,4,2))|
|setting.randomness_length|n*(n−1)|
|setting.slice_for(i)|開始startと終了endの2整数。`start,end=...; randomness[start:end]`。終了位置は含まない。n=3,i=1なら(2,4)で3番目と4番目|
|setting.as_dict()|{"parties":n,"modulus":p,"inputs":[…]}|
|sample_randomness(seed,setting)|再現可能な長さn*(n−1)の整数tuple。seedは渡された文字列をそのまま使う|
|honest_sum(setting)|sum(setting.inputs)%p|
|tiny_settings()|n=3,p=3、inputs=(1,2,1)と(1,0,0)の2設定。合計は両方1|
|randomness_space(setting)|可能な乱数tupleを全て順に渡す。tinyだけで使う。3の6乗=729通り|
|combinations(range(n),size)|その人数の全組合せ。例n=3,size=1で(0,),(1,),(2,)|
|CLAIMABLE / PROVIDED / NOT_PROVIDED|上の4性質／確認する2性質／与えない2性質。`sorted(...)`で名前のリストにできる|

shareにはちょうどn−1個のdrawsが渡ります。runには正しい長さと範囲のrandomnessが渡ります。runでは各iのsliceをshareへ渡します。例えばiの小さい順、その中でjの小さい順に送信記録を作れます。自分宛ても含め、(i,j)を一度ずつ記録してください。

## 各関数の返す形と、次に調べる理由

**correctness / transcript**：shareは長さnの整数list。runは下のdictです。outputと全valueは0〜p−1の整数（bool不可）、roundsは整数2。publicは受信者順です。公開記録の from は任意ですが、付けるならその受信者番号です。runとそのmessages/publicの記録には余分なキーを許します。

```python
{"output": 2,
 "messages": [{"from": 0, "to": 0, "value": 1}, ...],
 "public": [{"kind": "partial", "value": 0}, ...],
 "rounds": 2}
```

`...` は省略で、コードには実際の全件を入れます。出力が合っていても、宛先が重複する・受信した和と公開小計が違う記録は正しい実行ではありません。transcript はこの整合性と、各送信者の取り分を足した余りがその送信者の入力へ戻ることを確認します。

**privacy**：coalition は観測を持ち寄る人の番号tuple（重複なし・範囲内）。view は下の3キーだけを持つ形。received は元のmessagesの順序を保ち、toがcoalition内のものだけを `(from,to,value)` にしたtuple。public は元のpublicのvalueを順にしたtuple。outputはそのままです。順序・重複・値を省きません。

```python
{"received": ((0,1,2),(1,1,3),(2,1,1)), "public": (0,6,3), "output": 2}
```

これは上の例のcoalition=(1,)です。この教材の view は受信記録と公開記録だけです。本人の入力や送信乱数を含む完全な攻撃者の観測ではありません。

experiment_privacy は `{"id":"exp-privacy","ran":True,"passed":判定bool,"space":729}`。全員数未満の任意の組ではなく、tiny_settingsの人数nを使い、size=1からthreshold(n)−1までの全組を調べます。各組についてtinyの両設定の全乱数を使い、`repr(view(run(setting,r),coalition))` をリストに集め、sortedで並べ替えて比べます。reprはdict等を文字列表現にするPython機能。set（重複を消す集合）にすると頻度を失うので使いません。例[0,0,1]と[0,1,1]は可能な値が同じでも確率が違います。全組でリストが同じならpassed=True、一組でも違えばFalse。spaceは片方一設定の乱数個数です。

この確認は729通り・指定した二世界・限定した観測での正確な比較です。任意の入力や実システムの秘密性の証明ではありません。一部の組は両世界で自分の入力も変わるため、完全な攻撃者の観測が同じだとは主張しません。

**threshold**：threshold(n)はn−1。合計から自分たちの入力を引くと、残り一人の入力が出ます。上の例で0,1が組むと `(2−3−4)%7=2`。recoverは人数がn−1未満ならNone、n−1なら `(observed["output"]-sum(setting.inputs[i] for i in coalition))%p`。渡る組は最大n−1です。setting.inputsの組の外の値を読んで答える課題ではありません。隠せない境目は計算する機能自体の限界です。

**detect**：detects(protocol)は検査を作る最終的な応用です。protocolは `protocol(setting,randomness)` と呼べる関数。正しい実装ならFalse、欠陥を見つければTrueを返します。相手の関数名やコードを調べず、返した記録を実験してください。必要な規則はここまでの出力・記録・観測比較です。例：出力が2でも小計の和が3なら、合計の検査だけでは見落とします。どの入力や乱数を試し、どの矛盾を組み合わせて検査するかは自分で設計します。呼出しが例外で止まる場合も欠陥です。採点は未見の壊れ方を使います。全てのPythonプログラムの正しさを判定できるとは主張しません。

**measure**：sample_randomness(seed,setting)でrunを実行し、`{"rounds":記録のrounds,"messages":len(記録のmessages),"opened":len(記録のpublic),"unit":非空文字列,"environment":非空文字列}`。単位は取り分の送信件数（自分宛ても含む）と公開小計件数、環境はn人・割る数p・単一プロセスの模型であることを書きます。秒数や本物のネットワーク帯域ではありません。

**evidence**：4性質だけをキーにしたdict（余分な性質キーは不可）。各行は `{"claimed":bool,"experiment":文字列,"verdict":boolかNone,"limitation":非空文字列}`。correctness/privacyはclaimed=True、対応する実験の判定をverdictへ（成功時True）。残り2つはFalse/Noneで、experimentは空文字列でも可。correctnessは実際のrunの出力とhonest_sumを比較、privacyはexperiment_privacyを実行して結果を使います。実験のidは自分で付けた非空名、limitationには調べた範囲や保証しないことを書きます。報告の形だけで実験実行の証拠になるわけではありません。採点の個別検査と併せて成果を説明してください。
