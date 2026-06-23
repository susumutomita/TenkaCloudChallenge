# Cloudflare Workers Profile API — 5-Stage Security Scoring

> TenkaCloud Challenge · `challenges/cloudflare-api-security` · difficulty 3 · ~60–90 min · `flag` scoring

A **self-deploy + external-verify** API security drill. You deploy a deliberately
vulnerable profile API to **your own free Cloudflare Workers account**, fix it, and
hand your `*.workers.dev` URL to a TenkaCloud-side **Evaluator Lambda** that probes
it from the outside in 5 stages. Pass them all and the Evaluator returns the hidden
flag `TC{…}`.

No AWS charges: the AWS side is Lambda + S3 + SSM (free tier), and the problem
runtime is your free Cloudflare account.

## Story

天下クラウドの新人 SRE のあなたに、退職した前任者のプロフィール API のセキュリティ
レビューが回ってきた。スターターには OWASP API Security Top 10 由来の欠陥が仕込まれて
いる。直して、採点エンジンに通せ。

## What gets deployed

| Where | What |
| --- | --- |
| **Your free Cloudflare account** | The profile API (`index.js` on Cloudflare Workers) — the problem runtime |
| **TenkaCloud AWS account** | `EvaluatorFunction` (scoring Lambda) + `SetupBucket` (S3, starter) + SSM briefing + `ParticipantViewerRole` |

## The 5-stage scoring pipeline

| Stage | Name | What it checks (the **fixed** behavior) |
| --- | --- | --- |
| 0 | Deploy / healthz | `GET /healthz` → 200 + `{"status":"ok"}` |
| 1 | Input validation | malformed `:id` (SQLi / traversal / oversize) → 400/404, never 5xx, no error-body leak |
| 2 | Authorization / IDOR | no/invalid token → 401; valid token → own profile; another user's id → **403** |
| 3 | Info disclosure | error bodies leak no stack / path / token / internals |
| 4 | Regression | behavior consistent under repetition |

The flag is returned **only** on a full pass, lives only in the Evaluator's env, and
is not derivable from `NamePrefix` (a *discovered flag*).

## How to solve

1. **Briefing** — in CloudShell: `aws ssm get-parameter --name /<NamePrefix>/briefing --query Parameter.Value --output text`
2. **Get the starter** — `aws s3 cp s3://<NamePrefix>-tools-<accountId>/setup.sh . && bash setup.sh` (writes `./cloudflare-api-security/`)
3. **Deploy** — `cd cloudflare-api-security && npm i -g wrangler && wrangler login && wrangler deploy` → note your `https://<name>.workers.dev`
4. **Fix** the four `// VULN:` marks in `index.js`:
   - reject missing/invalid tokens with `401`
   - validate `:id` shape → `400`
   - block cross-user reads (`id !== caller.userId`) → `403`
   - return a generic error in `catch` (no `stack`/`message`)
   - then `wrangler deploy` again
5. **Score** — `./evaluate.sh <NamePrefix> https://<name>.workers.dev`
6. **Submit** the `TC{…}` printed on a full pass to the Participant Portal.

## API contract (what the Evaluator expects)

| Request | Expected |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok"}` |
| `GET /api/profile` (no/invalid token) | `401` |
| `GET /api/profile` (`Authorization: Bearer token-alice`) | `200` alice's profile |
| `GET /api/profile/alice` (alice's token) | `200` |
| `GET /api/profile/bob` (alice's token) | `403` (IDOR blocked) |
| `GET /api/profile/<malformed>` (valid token) | `400`/`404`, no 5xx, no leak |

Demo tokens: `token-alice` → `alice`, `token-bob` → `bob`.

## Scoring

| | |
| --- | --- |
| Kind | `flag` (`AnswerFlag` output) |
| Points | 400 |
| Wrong-answer penalty | 0 |
| Hints | 3 (progressive: run → diagnose → fix) |

## Security note (the Evaluator's own SSRF defenses)

Because the competitor supplies the URL, the Evaluator enforces: **https only**,
host must be a **`*.workers.dev` subdomain**, **redirects are not followed**,
**connect/read timeouts**, and a **response body size cap**. The `*.workers.dev`
allowlist means the target always resolves to Cloudflare's public edge — never a
private or metadata address.

## Cost

Zero. Cloudflare free tier covers the Worker; the AWS side stays within the free
tier and `delete-stack` removes everything.
