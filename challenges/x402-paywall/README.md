# The x402 Paywall That Collects Nothing

> TenkaCloud Challenge · `challenges/x402-paywall` · difficulty 3 · ~30 min · flag scoring

## Story

TenkaCloud Inc. This month's AI-crawler revenue: **0 USDC**.

Before he resigned, your predecessor Kato-san stood up an **x402 paywall** — a take on
[AWS WAF's new AI Traffic Monetization feature](https://aws.amazon.com/jp/blogs/news/aws-waf-adds-ai-traffic-monetization-capability-to-help-content-owners-charge-ai-bots-for-content-access/),
which charges AI bots for content access in USDC over the **x402 protocol** (HTTP `402 Payment Required` +
a machine-readable price manifest). The access logs show bots *are* being stopped at the gate — `402`
comes back every time. Yet not a single USDC has arrived.

Sasaki-san, the CTO: *"We're charging them but no money shows up. What kind of state is that? Fix it."*

Your job: find the one misconfiguration in the gate, fix it **by changing a setting** (no new
resources), then prove it works by completing a bot payment — which is the only thing that reveals the
hidden flag.

## What gets deployed

| Resource | Role |
| --- | --- |
| **Lambda Function URL** (`AuthType: NONE`, intentionally public) | The x402 gate. A request to a monetized path returns `402` + an x402 price manifest; a verified payment returns the content + flag. |
| **SSM config** `/{NamePrefix}/config/*` | `pay_to_wallet` (← **the fault: blank**), `monetized_path` (`/content/*`, correct), `currency_mode` (`test`, correct), `price_usdc`. The gate re-reads these on every request. |
| **SSM** `/{NamePrefix}/endpoint`, `/{NamePrefix}/briefing` | The content URL to curl, and the task briefing (readable by your role). |
| **ParticipantViewerRole** | Read your stack's SSM params; `ssm:PutParameter` scoped to `/{NamePrefix}/config/*` (the fix). No `cloudformation:DescribeStacks`, no `lambda:*` — so the flag can't be read off the Output or the function env. |

No EC2, no VPC, no blockchain, no real settlement. Everything is Lambda + SSM.

## How the x402 gate works

```
bot ──GET /content/premium-article──▶  Lambda gate
                                        │  reads SSM config
                                        ▼
              402 Payment Required + { "x402Version":1,
                "accepts":[{ "scheme":"exact","network":"base-sepolia",
                             "asset":"USDC","maxAmountRequired":"10000",
                             "payTo":"<wallet>","resource":"/content/..." }] }
bot ──GET + X-PAYMENT: <base64 payment>──▶  Lambda gate
                                        │  verifies payTo / network / amount (test mode)
                                        ▼
              200 OK + { "content":"…", "flag":"TC{…}" }
```

The catch: if `pay_to_wallet` is **blank**, the manifest's `payTo` is empty. The gate keeps demanding
payment, but there is **no destination to pay to** — so a bot can never complete the handshake, and you
collect nothing.

## How to solve

Everything below runs from **AWS CloudShell** (or any shell with your stack's credentials). Replace
`{NamePrefix}` with your team's prefix (shown in the portal).

**1. Find the endpoint and read the briefing.**
```bash
NP=tc-x402-paywall-<yourteam>        # your NamePrefix
URL=$(aws ssm get-parameter --name /$NP/endpoint --query Parameter.Value --output text)
aws ssm get-parameter --name /$NP/briefing --query Parameter.Value --output text
echo "$URL"
```

**2. Hit it as a bot — see the broken 402.**
```bash
curl -s -A "GPTBot" "$URL" | jq .
# 402 — note accepts[0].payTo is empty (" "): the gate can't be paid.
```

**3. Inspect the config and spot the fault.**
```bash
aws ssm get-parameters-by-path --path /$NP/config --recursive \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
# monetized_path=/content/*  (correct)   currency_mode=test (correct)
# pay_to_wallet=" "          ← blank: the planted fault
```

**4. Fix it — overwrite the existing parameter (no new resources).**
```bash
aws ssm put-parameter --name /$NP/config/pay_to_wallet \
  --value 0x00000000000000000000000000000000deadc0de --overwrite
# the company's test-net USDC wallet (any valid 0x… address works)
```

**5. Complete the x402 handshake with this helper, and read the flag.**

Save as `check_x402.sh`, `chmod +x check_x402.sh`, run `./check_x402.sh "$URL"`:
```bash
#!/usr/bin/env bash
# Minimal x402 client: GET -> read 402 manifest -> pay (test mode) -> GET again.
set -uo pipefail
URL="${1:?usage: check_x402.sh <content-url>}"
echo "[1/3] GET $URL  (User-Agent: GPTBot)"
manifest=$(curl -s -A "GPTBot" "$URL"); echo "$manifest" | jq .
payto=$(echo "$manifest" | jq -r '.accepts[0].payTo // "" | gsub("^\\s+|\\s+$";"")')
net=$(echo "$manifest"   | jq -r '.accepts[0].network // ""')
amt=$(echo "$manifest"   | jq -r '.accepts[0].maxAmountRequired // ""')
if [ -z "$payto" ] || [ "$payto" = "null" ]; then
  echo "[x] manifest has no payTo — the gate is misconfigured; a bot cannot pay to nowhere." >&2
  exit 1
fi
echo "[2/3] building test-mode X-PAYMENT for $payto on $net ($amt USDC base units)"
pay=$(printf '{"payTo":"%s","network":"%s","amount":"%s","txHash":"test-0xsim"}' \
        "$payto" "$net" "$amt" | base64 | tr -d '\n')
echo "[3/3] resubmitting with X-PAYMENT"
curl -s -A "GPTBot" -H "X-PAYMENT: $pay" "$URL" | jq .
# -> { "paid": true, "content": "...", "flag": "TC{…}" }
```

**6. Submit the `TC{…}` value** in the Participant Portal.

> The flag is only returned by a *verified* payment, and its value is random per deploy — you cannot
> derive it from the NamePrefix or read it off any Output. You have to push the payment through.

### Decoys (don't get nerd-sniped)

- `monetized_path = /content/*` already matches the content URL — it is **correct**.
- `currency_mode = test` is **correct**; switching it to `real` makes the gate demand on-chain mainnet
  settlement, which isn't available here, so payments stop verifying.

## Scoring

| | |
| --- | --- |
| Kind | `flag` (submit the `TC{…}` token once) |
| Points | 300 |
| Wrong-answer penalty | −15 |
| Hints | 3 (−20 / −50 / −100), progressively revealing symptom → faulty param → exact fix |

## Cost

Lambda (128 MB, a handful of invocations) + a few SSM Standard parameters. Effectively **$0** within the
free tier. `delete-stack` removes everything — no orphaned resources.

## Learning goals

- How machine-to-machine payment settles under **x402**: returning `402` isn't enough — a valid `payTo`,
  asset, and network must all line up before a bot can pay.
- The building blocks of the x402 protocol behind **AWS WAF AI Traffic Monetization** (price manifest /
  `X-PAYMENT` / test currency mode).
- **fix-by-settings**: repair a real misconfiguration (an empty `payTo`) with a single SSM overwrite.

## Related files

- [`template.yaml`](./template.yaml) — the gate, the SSM config (with the planted blank `pay_to_wallet`), and the participant role.
- [`metadata.json`](./metadata.json) — catalog entry, scoring, hints.
- [`challenges/net-evo-04-tls`](../net-evo-04-tls/) — the sibling "fix one SSM config value, then a protocol handshake hands you the flag" pattern.
