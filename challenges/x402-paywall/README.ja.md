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
Bot として支払いを完了させて動作を証明する ── 支払いの完了こそが、隠しフラグを出す唯一の方法だ。

## デプロイされるもの

| リソース | 役割 |
| --- | --- |
| **Lambda Function URL** (`AuthType: NONE`、意図的に公開) | x402 ゲート。課金対象パスへのアクセスには `402` + x402 価格マニフェストを返し、支払いが検証できればコンテンツ + フラグを返す。 |
| **SSM config** `/{NamePrefix}/config/*` | `pay_to_wallet` (← **これが空 = 不具合**)、`monetized_path` (`/content/*`、正しい)、`currency_mode` (`test`、正しい)、`price_usdc`。ゲートは毎リクエスト読み直す。 |
| **SSM** `/{NamePrefix}/endpoint`, `/{NamePrefix}/briefing` | 叩くコンテンツ URL と、タスク briefing (あなたのロールで読める)。 |
| **ParticipantViewerRole** | 自分の SSM パラメータを読む権限 + `/{NamePrefix}/config/*` への `ssm:PutParameter` (= 修正) のみ。`cloudformation:DescribeStacks` も `lambda:*` も無いので、フラグを Output や関数の環境変数から読むことはできない。 |

EC2・VPC・ブロックチェーン・実決済はいずれも無し。すべて Lambda + SSM。

## x402 ゲートの仕組み

```
bot ──GET /content/premium-article──▶  Lambda ゲート
                                        │  SSM config を読む
                                        ▼
              402 Payment Required + { "x402Version":1,
                "accepts":[{ "scheme":"exact","network":"base-sepolia",
                             "asset":"USDC","maxAmountRequired":"10000",
                             "payTo":"<wallet>","resource":"/content/..." }] }
bot ──GET + X-PAYMENT: <base64 payment>──▶  Lambda ゲート
                                        │  payTo / network / amount を検証 (test mode)
                                        ▼
              200 OK + { "content":"…", "flag":"TC{…}" }
```

肝心な点: `pay_to_wallet` が **空** だと、マニフェストの `payTo` も空になる。ゲートは支払いを要求し
続けるが、**振込先が無い** ので Bot はハンドシェイクを完了できず、1 円も徴収できない。

## 解き方

以下はすべて **AWS CloudShell** (またはスタックの認証情報がある任意のシェル) で実行。
`{NamePrefix}` はポータルに表示される自チームの prefix に置き換える。

**1. エンドポイントを取得し briefing を読む。**
```bash
NP=tc-x402-paywall-<yourteam>        # あなたの NamePrefix
URL=$(aws ssm get-parameter --name /$NP/endpoint --query Parameter.Value --output text)
aws ssm get-parameter --name /$NP/briefing --query Parameter.Value --output text
echo "$URL"
```

**2. Bot として叩く ── 壊れた 402 を見る。**
```bash
curl -s -A "GPTBot" "$URL" | jq .
# 402 ── accepts[0].payTo が空 (" ") であることに注目。これでは支払えない。
```

**3. config を調べて不具合を特定する。**
```bash
aws ssm get-parameters-by-path --path /$NP/config --recursive \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
# monetized_path=/content/*  (正しい)   currency_mode=test (正しい)
# pay_to_wallet=" "          ← 空: これが仕込まれた不具合
```

**4. 直す ── 既存パラメータを上書き (新規リソースは作らない)。**
```bash
aws ssm put-parameter --name /$NP/config/pay_to_wallet \
  --value 0x00000000000000000000000000000000deadc0de --overwrite
# 会社のテストネット USDC ウォレット (形式が正しい 0x… アドレスなら何でも可)
```

**5. ヘルパーで x402 ハンドシェイクを完了させ、フラグを読む。**

`check_x402.sh` として保存し、`chmod +x check_x402.sh`、`./check_x402.sh "$URL"` を実行:
```bash
#!/usr/bin/env bash
# 最小の x402 クライアント: GET -> 402 マニフェスト読取 -> 支払い (test mode) -> 再 GET。
set -uo pipefail
URL="${1:?usage: check_x402.sh <content-url>}"
echo "[1/3] GET $URL  (User-Agent: GPTBot)"
manifest=$(curl -s -A "GPTBot" "$URL"); echo "$manifest" | jq .
payto=$(echo "$manifest" | jq -r '.accepts[0].payTo // "" | gsub("^\\s+|\\s+$";"")')
net=$(echo "$manifest"   | jq -r '.accepts[0].network // ""')
amt=$(echo "$manifest"   | jq -r '.accepts[0].maxAmountRequired // ""')
if [ -z "$payto" ] || [ "$payto" = "null" ]; then
  echo "[x] マニフェストに payTo が無い ── ゲートの設定ミス。振込先が無いので Bot は払えない。" >&2
  exit 1
fi
echo "[2/3] $payto ($net, $amt USDC base units) 宛の test-mode X-PAYMENT を生成"
pay=$(printf '{"payTo":"%s","network":"%s","amount":"%s","txHash":"test-0xsim"}' \
        "$payto" "$net" "$amt" | base64 | tr -d '\n')
echo "[3/3] X-PAYMENT を付けて再送"
curl -s -A "GPTBot" -H "X-PAYMENT: $pay" "$URL" | jq .
# -> { "paid": true, "content": "...", "flag": "TC{…}" }
```

**6. 返ってきた `TC{…}` を** Participant Portal に提出。

> フラグは *検証済みの支払い* でしか返らず、値は deploy ごとのランダム。NamePrefix から導出することも、
> Output から読むこともできない ── 実際に支払いを通すしかない。

### おとり (深追い注意)

- `monetized_path = /content/*` はコンテンツ URL に既に一致している ── **正しい**。
- `currency_mode = test` も **正しい**。`real` に変えるとオンチェーンの mainnet 決済が必要になり、
  この環境では検証できなくなるので支払いが通らなくなる。

## 採点

| | |
| --- | --- |
| 種別 | `flag` (`TC{…}` トークンを 1 回提出) |
| 配点 | 300 |
| 誤答ペナルティ | −15 |
| ヒント | 3 段 (−20 / −50 / −100)。症状 → 壊れたパラメータ → 具体的な修正、と段階的に開示 |

## コスト

Lambda (128 MB、数回の呼び出し) + SSM Standard パラメータ数個。無料枠内で実質 **$0**。
`delete-stack` で全消去 ── 孤児リソースなし。

## 学べること

- **x402** で機械間決済がどう成立するか: `402` を返すだけでは不十分で、有効な `payTo` ・ 通貨 ・
  ネットワークが揃って初めて Bot が支払える。
- **AWS WAF AI Traffic Monetization** が依拠する x402 の要素 (price manifest / `X-PAYMENT` /
  test currency mode)。
- **fix-by-settings**: 実際の設定ミス (空の `payTo`) を SSM の上書き 1 つで直す。

## 関連ファイル

- [`template.yaml`](./template.yaml) — ゲート本体、SSM config (空の `pay_to_wallet` を仕込み)、participant role。
- [`metadata.json`](./metadata.json) — カタログ項目・採点・ヒント。
- [`challenges/net-evo-04-tls`](../net-evo-04-tls/) — 「SSM config を 1 つ直すとプロトコルのハンドシェイクがフラグを返す」姉妹パターン。
