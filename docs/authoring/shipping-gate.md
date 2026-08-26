# 問題の出荷ゲート

「この問題は出せる状態か」を機械で決めるための基準と、その基準が**どこで強制されるか**をまとめる。
Issue 382 の「基準の確定」に対応する。

## 使い方

```bash
bun run check:problem <problemId>   # 自分の 1 問だけ
bun run check:problem --all         # カタログ全問の合否を一覧で
```

第三者の PR も、各自が独自に作る問題も、リポジトリ全体を意識せずこの 1 コマンドで自分の問題の
状態が分かる。同じコマンドが CI の `checks` job でも `--all` で走るので、ローカルで緑なら CI でも
緑になる (逆も同じ)。

## 「成立している」の 4 条件と、その扱い

Issue 382 が候補として挙げた 4 つを、**強制する場所**で分類する。どれも「やらない」とは決めて
いない。強制のコストが違うので、置き場所が違う。

| 条件 | 強制する場所 | 実行のたびに掛かるもの |
| --- | --- | --- |
| metadata / 参加者画面 / 配信物が壊れていない | `check:problem` (PR ごと) | 数秒、ネットワーク不要 |
| 想定解法で checkpoint が通る (course 型) | `scripts/solvability-audit.ts` (PR ごと、shard 内) | 数分、ローカル実行のみ |
| 想定外の抜け道が無い (course 型) | `make solvability-sweep` (定期) | 十数分、seed 数千 |
| deploy が成功する / 採点が実際に加点される | `/validate-problem` の手順 (人が起動) | 実 AWS デプロイと課金 |

**`check:problem` が緑でも「解ける」証明にはならない。** 静的に確実に分かることだけを見ている。

### `/validate-problem` を実行した記録自体は誰が強制するか (Issue 463)

上の表の最後の行は「人が起動する」であって「起動したかどうかは誰も見ない」ではない。新規問題の
新問題、`status: ready` への昇格、既に `status: ready` な問題の participant-facing な書き換え
(README / hint / starter / workbench / portal) を、機械が止める仕組みは**もう無い**。
`playability-gate` と `scripts/check-pr-playability.ts`、`docs/PLAYABILITY_GOVERNANCE.md` は
2026-08-27 に削除した — 人間の blind play を待つ間 Issue が閉じられず、実際の運用で
ボトルネックになっていたため。

したがって「参加者が実際に解けるか」は**書いた人の申告が唯一の担保**になった。
`status: ready` へ上げるとき、その問題を解いた事実が無いなら上げない。
出力の末尾もそう読めない文言にしてある。

### `check:problem` が実際に見るもの

1. **metadata schema** — `SCHEMA.json` への適合。
2. **participant surface** — 参加者へ配信される HTML / inline script の既知欠陥
   (Issue 395 の template literal エスケープ、Issue 396 の `color-scheme` 未宣言)。
   ソースを読むと正しく見える種類なので、目視レビューでは落ちない。
3. **local playable** — `local/` を持つか。持たない = AWS 専用で、それ自体は**欠陥ではない**ので
   `skip`。ただし **AWS 専用であることを instructions に書いていなければ `fail`** (Issue 402)。
   黙っていると local play のカタログに出て、カードが開いて、最後に「自チームに deploy されて
   いません」で行き止まる。行き止まってから初めて分かるのが欠陥で、AWS 専用であることではない。
   決まった一文 (日本語「実 AWS アカウントが必要です」/ 英語 "requires a real AWS account") を
   要求している。prose を機械で縛るのは普通は筋が悪いが、ここは人のレビューに任せた結果が
   Issue 402 なので、書いたかどうかを機械が見る。
4. **local play url** — 問題文とアプリが local play の割り当てポートを焼き込んでいないか
   (Issue 399)。焼き込むと、別の問題を起動したまま起動した参加者が**別の問題へ飛ぶ**。
   1 問だけ起動している間は表面化しないので、作者は自分では踏まない。
5. **solvability (static)** — `solvability-audit --static-only`。対象は `local/verifier/server.py`
   を持つ course checkpoint 型に限られるので、それ以外は `skip`。

`skip` は「この問題には当てはまらない」であって「検査を省いた」ではない。`skip` を `fail` にすると
正しく作られた AWS 専用問題まで赤くなり、赤が意味を失う。

## 列挙は index.json ではなく filesystem から

`check:problem --all` は `battles/` と `challenges/` を直接走査する。`index.json` を起点にすると、
カタログへの登録を忘れた新問題が検査そのものをすり抜ける。登録漏れは `build-index.ts --check` が
別に落とす。

## CI と `bun run validate` のずれ

`.github/workflows/ci.yml` の `checks` job は検査を step ごとに手で並べている (失敗した検査名が
そのまま check 名に出るため)。この形は片方だけ増えるとずれる。実際に
`check-participant-surface.ts` と `generate-course-workbenches.py --check` が `bun run validate` に
だけ存在し、CI には無い状態になっていた。

`scripts/ci-validate-parity.test.ts` が両者の対応を機械で見る。`validate` に検査を足したら CI にも
step を足す。shard の test suite が代わりに担保しているものは、同 test の `COVERED_BY_SUITE` に
理由を書いて明示的に除外する。

## 新しい問題を作るとき

`bun run new <battles|challenges> <id>` が吐く雛形は、そのままで `check:problem` を通る。
`scripts/new-problem.test.ts` がそれを固定しているので、雛形が壊れれば CI が落ちる。

## 現状 (2026-08-08)

`bun run check:problem --all` は 72 問すべて緑。ただしこれは**静的検査の合否**であり、実 deploy を
伴う条件 (deploy 成功、想定解法での flag / checkpoint 通過、採点の加点) は含まない。実 AWS を
使う経路はこのリポジトリの gate からは呼ばない (`AGENTS.md` の「deploy、destroy、release、
production cloud command は実行しない」)。実 deploy を含めたベースラインの取得は未実施で、
Issue 382 の残作業として残る。
