# Deciding Who Sees What — StackStack safe exposure

> TenkaCloud Challenge · `challenges/stackstack-safe-exposure` · difficulty 3 · ~60–75 min · `multi-verify` scoring

The board runs, and it is about to be handed to a customer. What is missing is the line
between who sees what — and the one file that draws it was left empty.

It is **AWS-free**: one Docker container on your machine, no cloud account, no
credentials. What it models is an authorization plane — four accounts, four documents
that each carry an owner and a tenant and a visibility, and one declarative access
document, re-read on every request, that decides which of them may reach which.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** with `SCENARIO=safe-exposure` |
| `127.0.0.1:18080/portal` | The review console — rules, requirements, staging keys, gates |
| `127.0.0.1:18080/portal/review` | The same thing one probe at a time, with the rule that decided each |
| `127.0.0.1:18080/` | The board itself, unchanged from the earlier StackStack problems |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `127.0.0.1:18080/docs` | Browser API console; the access document changes through `PATCH /api/settings` |

The image is built from [`stackstack-base/`](../../stackstack-base), shared by every
StackStack problem. The four API keys, the draft ids and the two markings are derived
inside the container from a per-deploy random `FLAG_SEED`; the gate receipts come from a
separate secret generated at boot. No answer is stored in this repository and no two
deploys share one. Both ports are bound to `127.0.0.1` only.

### Honest about the model

There is no identity provider here. An account is an `Authorization: Bearer sk_...` key
resolved from a table inside the container — not Cognito, not an ALB authenticator. What
is the same is the property being graded: *a request with no valid principal never
reaches an admin object*, and *the object's own attributes participate in the decision*.

| Here | Real equivalent |
| --- | --- |
| four Bearer keys | a principal resolved by Cognito / an ALB authenticator |
| ordered rules in `access.json` | a declarative policy — IAM, OPA, ALB listener rules |
| `owner` / `tenant` / `shared` | attribute-based authorization over the resource |
| `/portal/admin/*` | an admin console or an operations API |
| `GET /portal/healthz` | the ALB or synthetic-monitor health path |

**The board itself is outside the document's reach.** `GET /`, `/api/board`, `/api/logs`,
`/healthz`, `/posture` and `POST /api/posts` belong to the shared base app, and a scenario
that redeclared one of them would fail at boot. So what this problem closes is everything
under `/portal`. The document does not reach further, and this README does not pretend it
does.

**`/portal` and `/portal/review` are never governed.** The instrument panel has to survive
a policy that locks you out of everything else, or the first over-tightening would also
remove the only thing that could explain it.

## Mission

Four checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| The reference inside the customer's draft | 30 | The `TC{exposed_...}` marking you were able to read |
| Admin screens, for admins only | 50 | The `admin_sealed` receipt from `GET /posture` |
| Drafts, for their owner and whoever they were shared with | 60 | The `drafts_scoped` receipt from `GET /posture` |
| Sign-off for the exposure review | 60 | `readyToken` from `GET /posture` |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-safe-exposure
   ```

2. Open the review console at `http://127.0.0.1:18080/portal`. It carries the rule
   grammar, the requirement vocabulary, the four staging keys, and the current state of
   the five gates. Then look at the state one probe at a time:

   ```
   curl -s http://127.0.0.1:18080/portal/review | jq '.groups | map_values(.ok)'
   ```

   ```jsonc
   {
     "service_intact": true,
     "drafts_usable": true,
     "drafts_scoped": false,
     "admin_available": true,
     "admin_sealed": false
   }
   ```

   Everything works. Nothing is protected. That is the state the previous SRE left.

3. Find out for yourself how far a request currently reaches. The drafts each say who
   owns them and which tenant they belong to:

   ```
   curl -s -H "Authorization: Bearer <a staging key>" http://127.0.0.1:18080/portal/drafts | jq
   curl -s http://127.0.0.1:18080/portal/admin/audit | jq '.decisions | length'
   ```

4. Rewrite the access document:

   Open `/docs`, inspect `GET /api/settings`, then use `PATCH /api/settings`.
   The repository remains read-only.

   There is nothing to restart — the file is re-read on every request. A document that
   will not load is an outage that says so: every governed route answers `503
   policy_error` with the problem named, and `/portal` still tells you what is wrong.

5. Open a red gate and read what is failing:

   ```
   curl -s http://127.0.0.1:18080/portal/review | jq '.groups.drafts_scoped.probes[] | select(.ok|not)'
   ```

   ```jsonc
   {
     "name": "sre-anzu reads pm-kenji's private draft (same tenant)",
     "object": "kenji-private",
     "expected": "403",
     "got": "200",
     "ok": false,
     "decidedBy": "default"
   }
   ```

6. Check the posture and submit:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": { "service_intact": true, "drafts_usable": true, "drafts_scoped": true,
                "admin_available": true, "admin_sealed": true },
     "tokens": { "drafts_scoped": "TC{...}", "admin_sealed": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   A receipt appears only while its gate is true, and `readyToken` only while all five
   are.

7. Retry from the starter with `DELETE /api/settings` after submitting the sign-off.

## The access document

```jsonc
{
  "defaultEffect": "allow" | "deny",
  "rules": [
    {
      "id":      "a name for humans (optional)",
      "effect":  "allow" | "deny",
      "methods": ["GET", "POST", "DELETE"],   // or ["*"]
      "path":    "/portal/draft",             // or "/portal/admin/*"
      "require": []
    }
  ]
}
```

- Rules are read in order. **The first rule whose method, path and every requirement all
  hold** decides. A rule that matches the path but whose requirements do not hold is *not*
  a match, so evaluation continues to the next rule — which is what lets two rules on one
  path express "mine, or shared with my tenant".
- If nothing matches, `defaultEffect` decides.
- `path` is an exact match. The only wildcard is a trailing `/*`: `/portal/admin/*`
  matches every path longer than `/portal/admin/`, and never `/portal/admin` itself.
- `require: []` means "no requirement". On a route with no single object — the list, the
  create, the admin routes — `owner`, `tenant` and `shared` are always false, because a
  decision that needs an attribute of a thing that is not there fails closed.

| `require` | Holds when |
| --- | --- |
| `anonymous` | the caller presented no key this app recognises |
| `authenticated` | the caller presented a key this app recognises |
| `role:member` / `role:admin` | that key's role |
| `subject:<id>` | that key belongs to exactly this one person |
| `owner` | the object's `owner` is the caller |
| `tenant` | the object's `tenant` is the caller's tenant |
| `shared` | the object's `visibility` is `team` |

Anything else is refused **by name**, and the document does not load until it is fixed —
including `client-ip:` and `ip:`. Every request arrives here through a published port, so
the address this app can see belongs to the proxy in front of it and not to the caller. A
source-address condition would decide nothing while looking like it decided something,
which is worse than not having one.

## The surfaces this problem adds

| Route | Governed | Purpose |
| --- | --- | --- |
| `GET /portal` | no | The review console, as a page |
| `GET /portal/review` | no | Every probe, expected versus got, and the rule that decided it |
| `GET /portal/healthz` | yes | The monitoring path |
| `GET /portal/me` | yes | Which identity a key is |
| `GET /portal/drafts` | yes | The list, filtered element by element by the object rule |
| `POST /portal/drafts` | yes | Write a draft (owner and tenant come from the key, never the body) |
| `GET /portal/draft?id=d-…` | yes | One draft |
| `DELETE /portal/draft?id=d-…` | yes | Remove one draft |
| `GET /portal/admin/handover` | yes | The predecessor's handover note |
| `GET /portal/admin/audit` | yes | This app's record of its own decisions |
| `GET /portal/admin/drafts` | yes | Every draft, across tenants |
| `DELETE /portal/admin/draft?id=…` | yes | Remove a draft as an administrator |

## Why it is built this way

The plausible wrong answers all look reasonable. That is the point.

- **`defaultEffect: "deny"` and nothing else.** One word, and the first thing an AI hands
  back when you ask it to make something safe. The leak stops. So does the business:
  `service_intact`, `drafts_usable` and `admin_available` all go red at once, and all
  three sealing checkpoints fail. Two of the five gates are about closing; three are about
  the service still working, and that ratio is deliberate.
- **One rule, `require: ["authenticated"]`, on everything.** It stops the requests with no
  key. It changes nothing else, because every probe that must be refused presents a key
  this app recognises. `drafts_scoped` and `admin_sealed` stay exactly as red as they
  were, which is the lesson.
- **Pin it to a known-good user — `require: ["subject:sre-anzu"]`.** Expressible on
  purpose, so the failure is demonstrable rather than hypothetical. `service_intact`
  covers three other identities reading their own work, and `drafts_usable` requires the
  customer the CTO just onboarded to be able to write.
- **Scope it to the tenant — `require: ["authenticated", "tenant"]`.** The plausible
  near-miss that feels like multi-tenancy done right. One same-tenant private draft is
  seeded for exactly this: `drafts_scoped` stays red.
- **Over-correct to `require: ["authenticated", "owner"]`.** The leak closes and
  `service_intact` goes red, because pm-kenji shared the runbook with the team on purpose.
  The right answer is a policy, not a maximum.
- **Allowlist the ids you saw while exploring.** `drafts_usable` writes a draft, reads it
  back and removes it inside the probe itself, with an id that did not exist when the
  policy was written. All four seeded ids are `FLAG_SEED`-derived too, so no allowlist can
  be prepared in this repository either.
- **Close the monitoring path.** `service_intact` goes red. "We made it safe by closing
  everything" is the failure this problem is named after.
- **Filter on source address.** Refused by name, with the reason, and the document does
  not load until it is removed.
- **Delete the draft that leaks.** `service_intact` goes red (the customer cannot read
  their own work) and so does `admin_available` (four documents are not four).
- **Fix it, copy the token, revert.** Every checkpoint sends real requests and re-evaluates
  every gate at the moment it is answered. A receipt is evidence about the app's state,
  never the grade.

### What scoring will not do to you

Every request a checkpoint sends is a **GET**. Nothing is created and nothing is removed,
so a wrong answer, a retry, or scoring the same checkpoint twice cannot change your
environment.

The gate probes do write — one draft, read back and removed — and that is why the whole
evaluation is synchronous from the first probe to the last. No other request can run in
between, so nothing you look at ever contains one, and nothing you wrote is touched. What
scoring *does* leave behind is entries in `GET /portal/admin/audit`: those are real
requests, and an audit trail that quietly omitted the auditor would be the wrong lesson.

### About the answer being in this repository

This catalog is open source. `scripts/stackstack-safe-exposure.test.ts` contains an access
document that passes, and the same tree is mounted in your checkout as `problems/`. It
cannot be hidden, so it is not pretended away — it is said here, and the hints are priced
with it in mind, which is why none of them is free. A suite without a reference policy
cannot prove that a checkpoint *accepts* the right answer, and that guarantee is worth
more than making the answer inconvenient to find.

### The honesty limit

The verdict is computed inside the container you are running. A participant who edits
`stackstack-base/` in their own checkout and rebuilds the image defeats every check here.
That is true of every container problem in this catalog; `make local` builds from the
pinned `problems/` submodule.

## Scoring

`multi-verify`, four checkpoints, 200 points total (Medium tier).

| Checkpoint | Points | Wrong answer | Hints |
| --- | --- | --- | --- |
| The reference inside the customer's draft | 30 | 2 | `4 / 9` |
| Admin screens, for admins only | 50 | 3 | `5 / 7 / 11` |
| Drafts, for their owner and whoever they were shared with | 60 | 3 | `6 / 9 / 13` |
| Sign-off for the exposure review | 60 | 2 | `8 / 15` |

Opening every hint in the problem costs 87 and still leaves 113. None of them is free —
see "About the answer being in this repository" above for why.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. The drafts and the decision record live entirely in the
container's memory, including the policy override, so tearing down leaves the repository
checkout untouched.

## What carries into the Battle

Honestly, and at the right granularity: this problem's verification logic is **not** yet
shared with [`stackstack`](../../battles/stackstack). That Battle is a `phased-polling`
CloudFormation problem with two phases, production-ramp and incident-response; there is no
Expose phase, the EC2 workload is a different application, and nothing there reads an
access document. What is built here so it *can* be shared later is the separation: the
probe groups are declarative tables and `runProbe` is the executor, so pointing a table of
the same shape at an ALB URL is the whole port. Adding an Expose phase and replacing the
EC2 workload is separate work, and this problem does not claim it has been done.

## Next

Before this one: [`stackstack-onboarding`](../stackstack-onboarding) (the environment
check) and [`stackstack-ship`](../stackstack-ship) (getting the board outside). After it,
the main event is the [`stackstack`](../../battles/stackstack) Battle.
