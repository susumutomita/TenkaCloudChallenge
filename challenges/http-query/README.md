# QUERY: The Method Nobody Knows

> 日本語版: [README.ja.md](./README.ja.md)

A Challenge built on **RFC 10008 — the HTTP `QUERY` method** (Standards Track, June 2026). `QUERY` is a brand-new method that is **safe and idempotent** and carries the query in the **request body**, not the URI. A search backend that implements it perfectly is nonetheless dead in production — because the *edge* doesn't know the new method yet. You diagnose where the request dies and fix the edge.

| Field          | Value                                                          |
| -------------- | ------------------------------------------------------------- |
| Category       | Challenge (self-paced)                                        |
| Difficulty     | 3 / 5 (intermediate)                                          |
| Estimated time | 30–45 min                                                     |
| status         | `ready`                                                       |
| Scoring        | `flag` (`points`: 300, `wrongAnswerPenalty`: 15)             |

## Story

Your predecessor — the previous SRE — migrated the search API onto the shiny new HTTP `QUERY` method (RFC 10008) and then resigned last week.

Now the screams arrive. Customers: *"Search is dead — it's returning 405."* But when you open the app code, `QUERY /search` is implemented exactly to spec. It works locally. Yet hitting the **production public URL** returns `405`.

The CTO: *"The code is right, isn't it? So what's killing it?"*

Your mission: find what is returning `405` on a spec-correct API, restore `QUERY /search` so it works through production, and craft a spec-compliant request that brings search back to life — and hands you the flag.

## What gets deployed

```
                        +----------------------------------------------+
                        |  Application Load Balancer (internet-facing)  |
   curl -X QUERY  --->  |  Listener :80                                 |
                        |   |- Rule p10  http-request-method in         |
                        |   |     { GET, HEAD, POST, OPTIONS }  --+      |
                        |   |     (QUERY is MISSING -- the bug)   |      |
                        |   \- default action: fixed-response 405 |      |
                        +-----------------------------------------+------+
                                            QUERY falls here <---+ | matched methods
                                            (405 at the edge)      v
                                              +-----------------------------------+
                                              |  Lambda search API (the backend)  |
                                              |  Correctly implements RFC 10008   |
                                              |  QUERY /search. The app is FINE.  |
                                              +-----------------------------------+
```

- **VPC + 2 public subnets** (an ALB needs two AZs), IGW, route table, an ALB security group (tcp/80 from the internet).
- **A Lambda** that correctly implements the RFC 10008 search API as an **ALB Lambda target**. It returns the ELB response shape and only hands out the flag for a *reached + spec-compliant* `QUERY`.
- **An internet-facing ALB** with an HTTP:80 listener whose **default action is a fixed `405`** and one **listener rule** that forwards only `GET / HEAD / POST / OPTIONS` to the backend. **`QUERY` is deliberately absent from that rule** — so `QUERY` never matches, falls through to the default action, and gets `405` *at the edge*. The app never sees it.
- **`ParticipantViewerRole`** — read-only baseline + just enough to diagnose and fix:
  - `elasticloadbalancing:Describe*` (read the LB / listener / rules),
  - `elasticloadbalancing:ModifyRule` scoped to **your own rule's ARN only**,
  - `logs:FilterLogEvents` / `GetLogEvents` on your Lambda's log group (confirm the app is healthy and `QUERY` never arrived),
  - `ec2:Describe*` tag-scoped to your stack.
  - **No `cloudformation:DescribeStacks`** — so the `AnswerFlag` Output is invisible to you. You can only learn the flag by reaching the app with a real, spec-compliant `QUERY`.

## How to solve

**1. See the symptom.** From the Participant Portal, grab the `SearchEndpoint` Output and hit it:

```bash
curl -i -X QUERY "$SEARCH_ENDPOINT" \
  -H 'content-type: application/json' \
  --data '{"query":{"match":"hello"}}'
# -> HTTP/1.1 405  (from the edge: "the edge method allow-list does not include this HTTP method")
```

**2. Prove the app is innocent.** A plain `GET` to the same URL returns `200` with a hint page, so the backend is alive. And the Lambda's CloudWatch Logs show **no QUERY invocation at all** — the request died *before* reaching the function:

```bash
aws logs filter-log-events --log-group-name "/aws/lambda/<NamePrefix>..." --limit 20
```

The 405 is produced by the **edge (ALB listener rule)**, not the app.

**3. Find the rule.** List the listener rules and read the method allow-list:

```bash
aws elbv2 describe-rules --listener-arn <your-listener-arn>
# -> one rule conditions on http-request-method = [GET, HEAD, POST, OPTIONS]   (no QUERY)
```

**4. Fix the edge (fix-by-settings).** Add `QUERY` to that rule's `http-request-method` Values — modifying the **existing** CFn-owned rule, not creating anything new:

```bash
aws elbv2 modify-rule --rule-arn <your-rule-arn> \
  --conditions 'Field=http-request-method,HttpRequestMethodConfig={Values=[GET,HEAD,POST,OPTIONS,QUERY]}'
```

(Console: **EC2 → Load Balancers → your LB → Listeners → Rules → edit**. The `ListenerRulesConsoleUrl` Output deep-links you to the LB.)

**5. Get the flag.** Re-run the `QUERY` from step 1. Now it reaches the backend, the spec-compliant request validates, and the response body returns the flag:

```bash
curl -s -X QUERY "$SEARCH_ENDPOINT" \
  -H 'content-type: application/json' \
  --data '{"query":{"match":"hello"}}'
# -> 200 ... Flag: TC{...}
```

Paste `TC{…}` into the Participant Portal. Correct → +300 pt. Wrong → -15 pt.

### Strict body handling (the backend, by design)

The API does **no content sniffing** — it teaches RFC 10008's strict request handling. Once the edge allows `QUERY`, these are all distinguishable from the app:

| Request                                              | Response |
| ---------------------------------------------------- | -------- |
| no `Content-Type`                                    | `415`    |
| `Content-Type` other than `application/json`         | `415`    |
| body is not valid JSON                               | `400`    |
| valid JSON but DSL is not `{"query":{"match":"<text>"}}`  | `422`    |
| valid `Content-Type` + valid JSON + valid DSL        | `200` + flag |
| `OPTIONS` (CORS preflight)                           | `204` + `Access-Control-Allow-Methods: …, QUERY, …` |
| `GET`                                                | `200` hint page (no flag) |
| `POST`                                               | `200` "this works, but POST is neither safe nor idempotent — use QUERY" (no flag) |

## Hints (cost score if used)

| hint   | Content                                                                                                 | Penalty |
| ------ | ------------------------------------------------------------------------------------------------------ | ------- |
| hint-1 | The app is fine: `GET` returns 200 and the Lambda logs show no QUERY arrived. Suspect the **edge** (ALB), not the app. | -15     |
| hint-2 | ALB listener rules have an HTTP-method allow-list (`http-request-method`). The current rule allows GET/HEAD/POST/OPTIONS — **QUERY isn't in it**, so QUERY hits the default 405. | -25     |
| hint-3 | Add QUERY to the rule's Values via `aws elbv2 modify-rule … HttpRequestMethodConfig={Values=[GET,HEAD,POST,OPTIONS,QUERY]}`, then re-send the QUERY. | -35     |

## Scoring

| State                                                      | Score |
| ---------------------------------------------------------- | ----- |
| Correct (`TC{…}` returned by a spec-compliant QUERY)       | +300  |
| Wrong                                                      | -15   |

## Cost

- The **ALB is an always-on charge** (hourly + LCU) for as long as the stack exists. There is no spot/burst discount on an ALB.
- Lambda (request-billed), VPC, subnets, IGW, security group, route tables are effectively **free** at this scale.
- **`delete-stack` when you're done.** The fix modifies an existing CFn-owned rule (no participant-created top-level resources), so deleting the stack leaves no orphans.

## Learning goals

- **Choose the method by HTTP semantics**, not by "does it have a body": a read-only, retry-safe search is `QUERY`; starting a side-effecting job is `POST`.
- **Why a brand-new standard method breaks across edges / middleboxes.** An ALB *can* forward a custom HTTP method — its `http-request-method` condition matches custom methods by exact, case-sensitive name (no wildcards) — once you add it to the allow-list. But **CloudFront returns `501` for non-standard methods** (which is exactly why this problem fronts the app with an ALB, not CloudFront), and a **browser `fetch({ method: 'QUERY' })` triggers a CORS preflight** that the server must answer with `Access-Control-Allow-Methods: …, QUERY`.
- **Isolate the middle of the path** (reverse proxy / WAF / API gateway / edge), not just the app, using logs and HTTP traces.
- **Strict `Content-Type` / body handling** (`400` / `415` / `422`) without content sniffing.

## The RFC and the lesson

- RFC 10008 — *The HTTP QUERY Method*: <https://www.rfc-editor.org/rfc/rfc10008>
- The thesis this problem dramatizes: a spec-compliant API can be dead end-to-end because the **standard, the browsers, the proxies, and the cloud edges all adopt a new method at different speeds**. Reading the new standard is half the skill; verifying real-world path compatibility and operationalizing it is the other half.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata (JA + `i18n.en`)
- [`template.yaml`](./template.yaml) — one-page CFn template (VPC + ALB + Lambda search API + scoped IAM role)
- [`diagram.svg`](./diagram.svg) — architecture overview
