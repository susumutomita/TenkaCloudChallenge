# 年に 2 日だけ、日次レポートが合わない

`cs-foundations` 第 9 章。 台帳も、それを集計するコードも誰も変えていません。
それでも年に 2 日、公開された日次レポートが台帳と一致しません。
現地の 1 日が、いつも 24 時間とは限らないからです。 そして食い違いはそこで終わりません。
範囲の先頭で offset を 1 回読む rollup はそれを範囲の最後まで使うので、切替のあとの毎日が
境目の 1 時間ぶんずつずれます。

## この問題が立っている落差

starter は `daily_totals` の public test をすべて通ります。 どのテストも切替のない普通の週を
集計するだけで、範囲の先頭で offset を 1 回読んですべての瞬間に足す実装は、その週なら正しいからです。
`counterexample` の public test 1 本だけは、関数を書くまで「未実装」と表示され、試すのも本文で
追った New York の 2 組だけです。

## checkpoint

| id | 点 | 種別 | 何で決まるか |
| --- | --- | --- | --- |
| `environment` | 15 | 直接回答 | Workbench の合言葉 (自動送信) |
| `observe` | 20 | 直接回答 | この deployment のレポートに対する `[reportId, "not-24-hours"]` |
| `audit` | 30 | 直接回答 | 公開値が台帳と違う行すべて — 切替日と、それより後の全行 |
| `rollup` | 45 | code | 普通の週、空の範囲、範囲外の event、実在の切替 1 つ、契約どおりのエラー |
| `transition` | 40 | code | 切替前後の時刻と 3 日ぶんの両端。 複数 zone・両方向・両方の切替をまたぐ範囲 |
| `counterexample` | 50 | code | `counterexample(zone, start_day, switch_day)` が返す 1 件を固定 offset が普通の日から奪うこと — 期待値ではなく性質 |

## 構成

```
local/starter/rollup.py       参加者が編集する 1 枚 (daily_totals, fixed_offset_day, counterexample)
local/reference/rollup.py     正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト (counterexample の 1 本は skip)
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 22 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来の日次レポートと台帳の値
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

zone も日付も system の tz database から取り、verifier seed とともに動きます。 public test で
見た週に特別対応しても通りません。 checker は契約が名指しするのと同じ暦で期待値を独立に組み立て、
日ごとに突き合わせます。

偶然に任せている部分はありません。 offset を間違えた実装が event を取り違えるのは、切替の瞬間を
またぐときではなく**日境界**をまたぐときです。 そのため生成される各日の最初と最後の 1 分は必ず
埋めます。 ここを乱数に任せると、checkpoint が欠陥を捕まえるかどうかが参加者の引いた seed 次第に
なってしまいます。 両方向を試すのも同じ理由で、時計が戻る日は短くなった日の終わりが、
進む日は翌日の始まりがあふれます。 そのため `transition` は複数 zone・2 年・両方向と、両方の切替を
含む範囲まで走査します。 seed で選んだ 1 つの切替だけでは片方の向きしか試せず、ラベルは両方を
約束しているからです。

誤答は意図的に 2 つに分けています。 固定 offset は目に見えて誤りです。 UTC の日で束ねてから
ラベルだけ現地日付に付け替える実装は、ラベルこそ本物の現地日付になりますが、そのラベルが指す
中身は名乗っている日ではないので、やはり誤りです。 これが `local/mutants/` の author 専用 mutant です。

使う zone はどれも、毎日の現地 0 時が存在し、一意です。 `rollup` と `transition` は 0 時から離れた
1 時間の切替だけを使います。 `counterexample` はそれに加えて、切替幅が 30 分の `Australia/Lord_Howe`
と、切替が日付の境目そのもの (春は 23 時 → 0 時、秋は 24 時 → 0 時ではなく 23 時) で起きる
`America/Nuuk` を seed によらず必ず含めます。 春の切替が 0 時 → 1 時で、切替日の 0 時が存在しない
zone (America/Santiago など) は使いません。 ここで扱うのは 1 日が 24 時間でなくなることであって、
壁時計時刻が存在しなくなることではありません。

### counterexample の性質

`counterexample(timezone_name, start_day, switch_day)` は 62 組で呼ばれます。 本文の New York の
2 組、そのあと seed で選んだ 3 zone と必ず入る 2 zone (`Australia/Lord_Howe`、`America/Nuuk`) の
各 zone × 2 年 × 両方の切替について、切替日当日から始まる範囲、数日前から始まる範囲、そして
**切替後の offset をすでに持つ**何か月も前から始まる範囲の 3 通りです。 返された入力を、starter の
固定 offset 算術と暦の 2 通りで集計し、範囲の中の切替日ではない日が足りなくなれば合格です。 比べる
期待値はありません。 何か月も前から始まる組が、本文の規則 (先頭 offset とその日の offset を比べる) と、
参加者が最初に試しがちな近道 (切替の向きで境目の時間帯を決める) を分けます。 そのような先頭からは、
切替のあとの日は 1 件もずれないからです。 30 分の切替は、本文が名指しする境目の 1 秒 (先頭 offset が
大きければその日の 23:59:59、小さければ 0:00:00) と、境目に近いだけの固定時刻 (23:30 / 0:30) を
分けます: 0:30 を 30 分早く読んでも同じ日の 0:00 であり、どの日も足りなくなりません。 1 秒刻みの
総当たりは 15 秒の制限で落ちます。 starter の `fixed_offset_day` を oracle にした範囲全体の 1 時間刻みの
探索は、30 分の窓を片方の向きで一度も踏まないので落ちます。 日を offset で選んでからその日の両端を
秒刻みで試す探索や、30 分刻み以下の探索は通ります — 参加者が自分で書いた本物の oracle なので、
意図どおりです。

failure message は破れた規則の名前と、関数に渡した公開の 3 つ組だけを含みます (AGENTS.md §15)。
verifier 自身の zone やレポートは決して出ません。

### fixture のレポート

日次レポートは、切替より前から始まる範囲に対して固定 offset の job が実際に公開する形で生成します。
時計が戻った切替なら、切替日から先の各日が最後の 1 時間ぶんを翌日に奪われ、最後の行の分は範囲の外へ
出てどこにも数えられません。 進んだ切替なら、切替日より後の各日が最初の 1 時間ぶんを前日に奪われ、
切替日自身は増えるだけです。 隣り合う移動量は必ず異なるので、偶然つり合う行はありません。
`audit` の答えは行から導くので、この形に従います: 切替日と、それより後の全行です。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が hidden を通り、22 個の mutation がすべて死ぬ
make up / make down  # Compose lab をローカルで起動・停止
```

`make reference-test` は以前より 15 秒ほど長くかかります。 mutant の 1 つが 1 秒刻みの総当たりで、
それを止められるのは verifier の時間制限だけだからです。

## 保証範囲

local modeはself-pacedなhonor-system verificationである。participantはmachine、Docker daemon、imageを管理する。
通常のparticipant imageはhidden test、reference、mutationを含まず、
hidden verifierは別imageである。それでもDockerを管理する人はauthor stageをbuildして中を読める。この分離は誤配を
防ぎ、悪意あるhost ownerから秘匿するものではない。submissionには時間・memory・process・output capをかける。
containerはnon-root、read-only、privilege無しで動き、masqueradeされたoutbound networkを持たない。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

すべての時刻計算を正しくしたのではない。 1 つの日次レポートと 1 つの範囲について、複数の zone と
両方向の切替を含めて、各 event がどの現地日に属するかを決めた。 そして、どの zone・どの範囲の先頭でも、
固定 offset が切替日だけでなく普通の日を間違えることを示した。 存在しない壁時計時刻や、2 回起きる
壁時計時刻はこの主張に含まれない。 この問題はそれを一度も尋ねていない。
