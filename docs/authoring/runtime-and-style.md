# runtime と game style は別の軸

問題を作るときの最初の選択は `battles` か `challenges` かではない。この順で決める。

1. **何を学ばせるか / 何を体験させるか**
2. **その学習目標に必要な runtime は何か** (Docker / 実クラウド / Simulator / Composite)
3. **どの採点・競技形式が適切か** (Challenge / Battle)

`Challenge` と `Battle` は競技と採点の形式であって、実行 runtime ではない。2 つを 1 つの選択に
潰すと、コンテナで足りる問題を作りたい人が CloudFormation の starter から始めることになる。

```bash
bun run new --runtimes                                   # 選べる runtime と使いどころ
bun run new <id> --runtime docker/compose --style challenge
```

`--runtime` と `--style` は非対話なので、CI からも AI agent からも決定論的に呼べる。

## なぜ制約が足場になるのか

2026-08-06 に、初見の利用者へ実際に問題を作ってもらったときの反応。

- local mode は「クラウド以外も含めて何でもできるもの」と受け取られた。
- cloud mode では「クラウドらしい問題にしなければ」と考えたので、題材を発想しやすかった。

**実行環境の制約は創作の邪魔ではなく、何を問題にするかを決める有効な足場になっている。**
だから runtime を先に選ぶ。

## runtime 判断ガイド

### `docker/compose` — ローカルで完結する演習

コンテナの中で本質を再現できる題材に使う。

- Web アプリケーション、API、DB、ファイル、設定、ログ
- バックアップ公開、認可不備、SQL injection、運用ミス
- Linux の process、network、可観測性、復旧操作
- 高速・無料・再現可能な個人学習を優先する問題

**「AWS っぽい名前を付ける」だけの問題にはしない。** 学習目標がクラウド固有でないなら、
Docker で十分である。

題材を絞る問い。

- 消し忘れたファイルや、有効なままの設定はあるか
- 認証を通った後に、別ユーザーのデータへ触れてしまわないか
- ログや監視が無く、故障原因を特定できない状態を作れるか

追加の成立条件。

- 参加者が触る面はコンテナの中で完結し、外向き通信を要求しない
- healthcheck と resource limit を宣言する
- `/verify` (または multi-verify) の contract を持つ

### `aws/cloudformation` — 実クラウド

学習目標が provider 固有の control plane や managed service の意味論に依存する場合に選ぶ。

- IAM policy evaluation、AssumeRole、ExternalId
- VPC / Security Group / route / endpoint
- CloudFormation lifecycle
- managed database、queue、event、logging、autoscaling
- AWS Console や AWS CLI で実リソースを観察・復旧すること自体が学習目標

題材を絞る問い。

- IAM、network、managed service、eventual consistency のどれを体験させたいか
- Console / CLI / IaC のどの観察が解法の核心か
- **実クラウドでなければ成立しない理由**は何か

最後の問いに答えられないなら `docker/compose` で足りる。

追加の成立条件。

- standing cost と、問題終了後に課金が残らないこと (cleanup)
- 参加者 role が least privilege であること
- region 差と quota に当たらないこと
- 同じ template を何度 deploy しても同じ問題になること (再現性)

### `simulator/*` — TenkaCloudSimulator

クラウド型の API・resource model・failure scenario を、実アカウントと課金なしで再現したい
場合に選ぶ。

**現況: この repository に Simulator runtime の問題はまだ 1 問も無い。** 複製できる実例が無い
ので、`bun run new --runtime simulator/aws` は動くように見える雛形を作らずに断る。動く雛形を
渡す方が親切に見えるが、それは deploy できない問題を書き進めさせることになる。

将来この runtime を使うときの成立条件。

- 対応済み capability だけを使う
- 未対応の操作を「成功したこと」にしない
- 実クラウドと同一でない境界を問題文と metadata に明示する
- experimental の間は `status: ready` へ進めない

### `composite` — 複合 runtime

学習目標が control plane と実 workload の**両方**にまたがる場合だけ選ぶ。単一 runtime で
成立する問題を不必要に composite にしない。

実例は `challenges/hello-multicloud` の 1 問で、これが starter になる。

追加の成立条件。

- component ごとの ownership、network、secret、採点境界を明示する
- `scoring.targets[].targetId` が `runtime.targets[].id` に実在する
- 単一 runtime で足りない理由を design note に残す

## game style 判断ガイド

runtime を決めた後に、別の軸として選ぶ。

### Challenge

- 明確な到達条件がある
- flag / multi-verify / probe で完了を判定できる
- 個人学習、self-paced、順序立てた checkpoint に向く

### Battle

- 時間経過・継続採点・攻撃・防御・他チームとの比較が本質
- 初期状態、phase transition、採点周期、終了条件を定義する

**単に難しい Challenge を Battle と呼ばない。** 難易度は軸ではない。

## 組み合わせに実例が無いとき

`bun run new` は、実例のある組み合わせしか scaffold しない。断り方は 2 通りあり、作者が次に
取る行動が違う。

- **「まだ実行できません」** — その runtime 自体がこの repository で動かない (`simulator/*`)。
  別の runtime を選ぶ。
- **「実例がありません」** — runtime は動くが、その style の問題がまだ無い
  (`composite` の Battle)。その形の問題を 1 問作ってから starter にする。

## starter を専用に作らない理由

scaffold は「動いている問題を複製する」形で、複製元は catalog の gate を通り続けている。
専用の starter を別に置くと、それだけが誰にも遊ばれないまま腐る。runtime ごとに**その runtime
で最も小さい実在の問題**を指す方が、starter が壊れたことに誰かが気付く。

`scripts/problem-runtimes.test.ts` が、宣言した starter が実在すること、他 runtime の artifact
を持ち込んでいないこと、starter 自身の `runtime` 宣言が食い違っていないことを固定している。

## なぜこの runtime なのかを残す

生成後、`metadata.json` の `description` か `docs/design/` に 1 行で理由を残す。後から読む人が
その判断をやり直さずに済む。特に `aws/cloudformation` と `composite` は、「Docker では足りない
理由」がそのまま問題の価値の説明になる。

## 旧形式

`bun run new <battles|challenges> <id>` は移行期間として動く。呼ぶと移行警告が出る。
