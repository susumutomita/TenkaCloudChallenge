# The x402 Paywall That Collects Nothing

> TenkaCloud Challenge · `challenges/x402-paywall` · difficulty 3 · ~30 min · flag scoring

## Story

TenkaCloud Inc. This month's AI-crawler revenue: **0 USDC**.

Before he resigned, your predecessor the previous SRE stood up an **x402 paywall** — a take on
[AWS WAF's new AI Traffic Monetization feature](https://aws.amazon.com/jp/blogs/news/aws-waf-adds-ai-traffic-monetization-capability-to-help-content-owners-charge-ai-bots-for-content-access/),
which charges AI bots for content access in USDC over the **x402 protocol** (HTTP `402 Payment Required` +
a machine-readable price manifest). The access logs show bots *are* being stopped at the gate — `402`
comes back every time. Yet not a single USDC has arrived.

The CTO, the CTO: *"We're charging them but no money shows up. What kind of state is that? Fix it."*

Your job: find the one misconfiguration in the gate, fix it **by changing a setting** (no new
resources), then prove it works by completing a bot payment — the only thing that reveals the flag.

## What gets deployed

| Resource | Role |
| --- | --- |
| **`GateFunction`** (Lambda, no public URL) | The x402 gate. The player invokes it as the bot client with `aws lambda invoke` (their own creds — no public endpoint, so nothing for an org guardrail to block). A monetized path returns `402` + an x402 manifest; a verified payment returns the content + flag. |
| **`ToolsBucket`** (private S3) | Holds the bot-client tool `check_x402.sh`, populated by a custom resource at deploy. The player downloads it with `aws s3 cp`. Emptied on stack delete. |
| **SSM config** `/{NamePrefix}/config/*` | `pay_to_wallet` (← **the fault: blank**), `monetized_path` (`/content/*`, correct), `currency_mode` (`test`, correct), `price_usdc`. The gate re-reads these on every invocation. |
| **SSM** `/{NamePrefix}/gate_function`, `/{NamePrefix}/briefing` | The gate's function name, and the full step-by-step briefing (readable by the participant role). |
| **ParticipantViewerRole** | `lambda:InvokeFunction` on the gate; `s3:GetObject` on the tools bucket; `ssm:PutParameter` scoped to `/{NamePrefix}/config/*` (the fix); SSM reads. **No `cloudformation:DescribeStacks`, no `lambda:GetFunction*`** — so the flag can't be read off the Output or the function env. |

No EC2, no VPC, no public endpoint, no blockchain, no real settlement. Lambda + S3 + SSM only.

## How the x402 gate works

```
bot ──invoke {rawPath:/content/...}──▶  GateFunction
                                         │  reads SSM config
                                         ▼
              402 + { "x402Version":1,
                "accepts":[{ "scheme":"exact","network":"base-sepolia",
                             "asset":"USDC","maxAmountRequired":"10000",
                             "payTo":"<wallet>","resource":"/content/..." }] }
bot ──invoke {..., headers:{x-payment:<base64>}}──▶  GateFunction
                                         │  verifies payTo / network / amount (test mode)
                                         ▼
              200 + { "content":"…", "flag":"TC{…}" }
```

The catch: if `pay_to_wallet` is **blank**, the manifest's `payTo` is empty. The gate keeps demanding
payment, but there is **no destination to pay to** — so a bot can never complete the handshake, and you
collect nothing.

## How to solve

Everything below runs from **AWS CloudShell** (which already has your stack's credentials). Replace
`{NP}` with your team's NamePrefix (shown in the portal, e.g. `tc-x402-paywall-yourteam`).

**1. Read the briefing — it has every command.**
```bash
NP=tc-x402-paywall-yourteam
aws ssm get-parameter --name /$NP/briefing --query Parameter.Value --output text
```

**2. Download the bot-client tool from the stack's S3 bucket.**
```bash
aws s3 cp s3://$NP-tools-$(aws sts get-caller-identity --query Account --output text)/check_x402.sh .
chmod +x check_x402.sh
```

**3. Run it as a bot — see the broken `402`.**
```bash
./check_x402.sh $NP
# [1/3] GET /content/premium-article ... HTTP 402
# {... "payTo": "" ...}
# [x] the x402 manifest has no payTo -- the gate demands payment but names no destination.
```

**4. Inspect the config and spot the fault.**
```bash
aws ssm get-parameters-by-path --path /$NP/config --recursive \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
# monetized_path=/content/*  (correct)   currency_mode=test (correct)
# pay_to_wallet=" "          ← blank: the planted fault
```

**5. Fix it — overwrite the existing parameter (no new resources).**
```bash
aws ssm put-parameter --name /$NP/config/pay_to_wallet \
  --value 0x00000000000000000000000000000000deadc0de --overwrite
# the company's test-net USDC wallet (any valid 0x… address works)
```

**6. Re-run the tool — the handshake completes and prints the flag.**
```bash
./check_x402.sh $NP
# [1/3] GET ... HTTP 402   (now the manifest advertises the wallet)
# [2/3] paying: building a test-mode X-PAYMENT to 0x…deadc0de on base-sepolia
# [3/3] resubmitting with X-PAYMENT ... HTTP 200
# {... "flag": "TC{…}" }
# >> flag: TC{…}   (submit this in the Participant Portal)
```

**7. Submit the `TC{…}` value** in the Participant Portal.

> The flag is only returned by a *verified* payment, and its value is random per deploy — you cannot
> derive it from the NamePrefix or read it off any Output / the function env. You have to push the
> payment through.

### Decoys (don't get nerd-sniped)

- `monetized_path = /content/*` already matches the content path — it is **correct**.
- `currency_mode = test` is **correct**; switching it to `real` makes the gate demand on-chain mainnet
  settlement, which isn't available here, so payments stop verifying.

## Scoring

| | |
| --- | --- |
| Kind | `flag` (submit the `TC{…}` token once) |
| Points | 300 |
| Wrong-answer penalty | −15 |
| Hints | 3 (−20 / −50 / −100), progressively revealing first-step → faulty param → exact fix |

## Cost

Lambda (128 MB, a handful of invocations) + a private S3 bucket holding one small object + a few SSM
Standard parameters. Effectively **$0** within the free tier. `delete-stack` empties the bucket and
removes everything — no orphaned resources.

## Learning goals

- How machine-to-machine payment settles under **x402**: returning `402` isn't enough — a valid `payTo`,
  asset, and network must all line up before a bot can pay.
- The building blocks of the x402 protocol behind **AWS WAF AI Traffic Monetization** (price manifest /
  `X-PAYMENT` / test currency mode).
- **fix-by-settings**: repair a real misconfiguration (an empty `payTo`) with a single SSM overwrite.

## Related files

- [`template.yaml`](./template.yaml) — the gate Lambda (+ the custom resource that seeds the tools bucket), the SSM config with the planted blank `pay_to_wallet`, and the participant role.
- [`metadata.json`](./metadata.json) — catalog entry, scoring, hints.
- [`challenges/net-evo-04-tls`](../net-evo-04-tls/) — the sibling "fix one SSM config value, then a protocol handshake hands you the flag" pattern.
