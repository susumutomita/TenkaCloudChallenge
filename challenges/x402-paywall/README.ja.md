# x402 課金ゲート — 課金しているのに 0 USDC

> TenkaCloud Challenge · `challenges/x402-paywall` · 難易度 3 · 約 30 分 · flag 採点

## ストーリー

天下クラウド株式会社。今月の AI クローラー課金売上は **0 USDC**。

前任 SRE の加藤さんは退職前に **x402 課金ゲート** を立てた ──
[AWS WAF の新機能 AI Traffic Monetization](https://aws.amazon.com/jp/blogs/news/aws-waf-adds-ai-traffic-monetization-capability-to-help-content-owners-charge-ai-bots-for-content-access/)
を模したもので、**x402 プロトコル** (HTTP `402 Payment Required` + 機械可読な価格マニフェスト) を使い
AI Bot からコンテンツ閲覧料を USDC で徴収する。アクセスログを見ると Bot は毎回ゲートに弾かれている
(`402` が返っている)。なのに 1 USDC も入ってこない。

佐々木 CTO「課金してるのに金が入らないって、どういう状態だ。直してくれ」。

あなたの仕事: ゲートの設定ミスを 1 つ見つけ、**設定変更で直し** (新しいリソースは作らない)、
Bot として支払いを完了させて動作を証明する ── 支払いの完了こそが、フラグを出す唯一の方法だ。

## デプロイされるもの

| リソース | 役割 |
| --- | --- |
| **`GateFunction`** (Lambda、公開 URL なし) | x402 ゲート。プレイヤーは Bot クライアントとして **自分の権限で `aws lambda invoke`** して叩く (公開エンドポイント無し＝組織ガードレールで弾かれる面が無い)。課金対象パスには `402` + x402 マニフェスト、支払い検証成功でコンテンツ + フラグを返す。 |
| **`ToolsBucket`** (非公開 S3) | Bot クライアント `check_x402.sh` を配置 (デプロイ時にカスタムリソースが書き込む)。プレイヤーは `aws s3 cp` で取得。スタック削除時に空にする。 |
| **SSM config** `/{NamePrefix}/config/*` | `pay_to_wallet` (← **これが空 = 不具合**)、`monetized_path` (`/content/*`、正しい)、`currency_mode` (`test`、正しい)、`price_usdc`。ゲートは毎呼び出し読み直す。 |
| **SSM** `/{NamePrefix}/gate_function`, `/{NamePrefix}/briefing` | ゲートの関数名と、手順入りの briefing (participant role で読める)。 |
| **ParticipantViewerRole** | ゲートへの `lambda:InvokeFunction`、tools バケットへの `s3:GetObject`、`/{NamePrefix}/config/*` への `ssm:PutParameter` (= 修正)、SSM 読取。**`cloudformation:DescribeStacks` も `lambda:GetFunction*` も無い** ので、フラグを Output や関数の環境変数から読めない。 |

EC2・VPC・公開エンドポイント・ブロックチェーン・実決済はいずれも無し。Lambda + S3 + SSM のみ。

## x402 ゲートの仕組み

```
bot ──invoke {rawPath:/content/...}──▶  GateFunction
                                         │  SSM config を読む
                                         ▼
              402 + { "x402Version":1,
                "accepts":[{ "scheme":"exact","network":"base-sepolia",
                             "asset":"USDC","maxAmountRequired":"10000",
                             "payTo":"<wallet>","resource":"/content/..." }] }
bot ──invoke {..., headers:{x-payment:<base64>}}──▶  GateFunction
                                         │  payTo / network / amount を検証 (test mode)
                                         ▼
              200 + { "content":"…", "flag":"TC{…}" }
```

肝心な点: `pay_to_wallet` が **空** だと、マニフェストの `payTo` も空になる。ゲートは支払いを要求し
続けるが、**振込先が無い** ので Bot はハンドシェイクを完了できず、1 円も徴収できない。

## 解き方

以下はすべて **AWS CloudShell** (スタックの認証情報が入っている) で実行。`{NP}` はポータルに表示される
自チームの NamePrefix (例 `tc-x402-paywall-yourteam`) に置き換える。

**1. briefing を読む ── 全コマンドが載っている。**
```bash
NP=tc-x402-paywall-yourteam
aws ssm get-parameter --name /$NP/briefing --query Parameter.Value --output text
```

**2. スタックの S3 バケットから Bot クライアントツールを取得。**
```bash
aws s3 cp s3://$NP-tools-$(aws sts get-caller-identity --query Account --output text)/check_x402.sh .
chmod +x check_x402.sh
```

**3. Bot として実行 ── 壊れた `402` を見る。**
```bash
./check_x402.sh $NP
# [1/3] GET /content/premium-article ... HTTP 402
# {... "payTo": "" ...}
# [x] the x402 manifest has no payTo -- 振込先が無いので Bot は払えない。
```

**4. config を調べて不具合を特定する。**
```bash
aws ssm get-parameters-by-path --path /$NP/config --recursive \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
# monetized_path=/content/*  (正しい)   currency_mode=test (正しい)
# pay_to_wallet=" "          ← 空: これが仕込まれた不具合
```

**5. 直す ── 既存パラメータを上書き (新規リソースは作らない)。**
```bash
aws ssm put-parameter --name /$NP/config/pay_to_wallet \
  --value 0x00000000000000000000000000000000deadc0de --overwrite
# 会社のテストネット USDC ウォレット (形式が正しい 0x… アドレスなら何でも可)
```

**6. ツールを再実行 ── ハンドシェイクが通りフラグが出る。**
```bash
./check_x402.sh $NP
# [1/3] GET ... HTTP 402   (マニフェストが wallet を広告するようになる)
# [2/3] paying: 0x…deadc0de 宛 (base-sepolia) の test-mode X-PAYMENT を生成
# [3/3] resubmitting with X-PAYMENT ... HTTP 200
# {... "flag": "TC{…}" }
# >> flag: TC{…}   (これを Participant Portal に提出)
```

**7. 返ってきた `TC{…}` を** Participant Portal に提出。

> フラグは *検証済みの支払い* でしか返らず、値は deploy ごとのランダム。NamePrefix から導出することも、
> Output や関数の環境変数から読むこともできない ── 実際に支払いを通すしかない。

### おとり (深追い注意)

- `monetized_path = /content/*` はコンテンツパスに既に一致 ── **正しい**。
- `currency_mode = test` も **正しい**。`real` に変えるとオンチェーンの mainnet 決済が必要になり、
  この環境では検証できなくなるので支払いが通らなくなる。

## 採点

| | |
| --- | --- |
| 種別 | `flag` (`TC{…}` トークンを 1 回提出) |
| 配点 | 300 |
| 誤答ペナルティ | −15 |
| ヒント | 3 段 (−20 / −50 / −100)。最初の一手 → 壊れたパラメータ → 具体的な修正、と段階開示 |

## コスト

Lambda (128 MB、数回の呼び出し) + 小さなオブジェクト 1 つの非公開 S3 バケット + SSM Standard
パラメータ数個。無料枠内で実質 **$0**。`delete-stack` がバケットを空にして全消去 ── 孤児リソースなし。

## 学べること

- **x402** で機械間決済がどう成立するか: `402` を返すだけでは不十分で、有効な `payTo` ・ 通貨 ・
  ネットワークが揃って初めて Bot が支払える。
- **AWS WAF AI Traffic Monetization** が依拠する x402 の要素 (price manifest / `X-PAYMENT` /
  test currency mode)。
- **fix-by-settings**: 実際の設定ミス (空の `payTo`) を SSM の上書き 1 つで直す。

## 関連ファイル

- [`template.yaml`](./template.yaml) — ゲート Lambda (+ tools バケットを seed するカスタムリソース)、空の `pay_to_wallet` を仕込んだ SSM config、participant role。
- [`metadata.json`](./metadata.json) — カタログ項目・採点・ヒント。
- [`challenges/net-evo-04-tls`](../net-evo-04-tls/) — 「SSM config を 1 つ直すとプロトコルのハンドシェイクがフラグを返す」姉妹パターン。
