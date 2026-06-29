# rls-tenant-isolation — Multi-Tenant Data Leak (Postgres RLS)

A self-contained **local-play** Challenge for TenkaCloud. It runs entirely in
Docker — no AWS account, no cloud resources — and uses the container `/verify`
scoring contract (#2054). A BtoB SaaS document-management app has a broken
tenant boundary; you fix it with Postgres Row Level Security.

> Deliberately vulnerable training target. The compose file binds it to
> `127.0.0.1` only; never expose it off loopback.

## Play it

```bash
make local PROBLEM=rls-tenant-isolation   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** <http://127.0.0.1:18080> — the documents API.
- **Goal:** make every company's documents invisible and immutable to the other
  company, enforced in the database, then submit to pass all 7 attack tests.

## The story

You inherit a multi-company document-management SaaS (Supabase-style: Postgres +
PostgREST). Two customers are live — **Acme Corp** and **Beacon Inc** — each with
an owner and a member and a handful of confidential documents. A support ticket
says an Acme user pasted a link with someone else's document id and saw a
**Beacon** document. The tenant boundary is broken.

## The domain

| Table           | Columns                                                            |
| --------------- | ----------------------------------------------------------------- |
| `organizations` | `id`, `name`                                                      |
| `memberships`   | `user_id`, `organization_id`, `role` (`owner` \| `member`)        |
| `documents`     | `id`, `organization_id`, `title`, `body`, `created_by`           |

Seeded actors (the API maps `x-user-id` to one of these):

| user          | org    | role   |
| ------------- | ------ | ------ |
| `alice-owner` | Acme   | owner  |
| `amir-member` | Acme   | member |
| `bella-owner` | Beacon | owner  |
| `ben-member`  | Beacon | member |

## Reproduce the leak

The starter API carries identity (`x-user-id` stands in for a verified Supabase
JWT) but relies on app-side `organization_id` filtering — and the by-id paths
forget to filter:

```bash
# Acme's owner reads a Beacon document just by swapping the id — LEAK.
curl -H 'x-user-id: alice-owner' http://127.0.0.1:18080/documents/00000000-0000-0000-0000-00000000bd01

# The anonymous/public client lists everything — LEAK.
curl http://127.0.0.1:18080/documents
```

## Threat model

The attacker is a **legitimate, authenticated user of one tenant** (or the
**public/anon client**). They cannot forge another user's identity, but they
**can**:

- Tamper with the `document_id` in a URL / API parameter / Supabase client call.
- Call any endpoint, including ones the UI never links to (search, count, CSV
  export, the raw by-id read/write).
- Use the project's **anon key** (the public client) directly.
- Send an INSERT/UPDATE whose `organization_id` points at another tenant
  (smuggling a row across the boundary or reassigning ownership).

Assets to protect: every other tenant's `documents` rows — confidentiality
(no cross-tenant read, search, count, or export) and integrity (no cross-tenant
update/delete, no ownership reassignment).

### Why app-side `organization_id` filtering is insufficient

App-side filtering (`... where organization_id = $current_user_org`) is a single
gate that an attacker can walk around:

1. **It is per-code-path.** It only protects the queries a developer remembered
   to filter. The by-id GET/PATCH in this starter — and realistically a search,
   a count, a CSV export, an admin shortcut — each need the same `WHERE`, and any
   one omission leaks. The database has no opinion, so the omission is silent.
2. **Parameter tampering reaches the row anyway.** Even a filtered query trusts a
   client-supplied id; flip the id and a forgotten branch returns it.
3. **The anon/public client bypasses the app entirely.** Supabase exposes the
   table through PostgREST; a request with the anon key never runs your
   application filter at all. Only a database-level rule can deny it.
4. **WITH CHECK has no app equivalent.** Stopping an `UPDATE` that *moves*
   `organization_id` to another tenant is a property of the *new* row — exactly
   what RLS `WITH CHECK` expresses and what scattered app code routinely misses.

So the boundary must live in the database as the **last line of defense**: RLS
denies the row regardless of which code path (or which client) reaches it.

## How to solve

Enforce the boundary in Postgres. Edit `local/solution/policies.sql` (it starts
empty → the container loads the vulnerable state), then restart:

```bash
make local PROBLEM=rls-tenant-isolation   # rebuild/restart to re-apply policies
```

Your policies must satisfy all seven checks:

1. RLS **enabled** on `public.documents` (and `force` so the table owner is bound too).
2. `SELECT` only your own org's rows.
3. `INSERT`/`UPDATE` only into your own org, with **`WITH CHECK`** so
   `organization_id` cannot be set/moved to another org.
4. `DELETE` restricted to **owners**.
5. The **anon** client reads nothing.

The schema (`local/db/schema.sql`) already defines the identity helpers you use
in policies: `app.current_user_id()`, `app.is_authenticated()`,
`app.current_org_ids()`, `app.is_owner_of(org)`. A full reference answer lives in
`local/reference/policies.sql`.

## How scoring works

The platform holds no answer. On submit, the local scoring API forwards to the
container's loopback `/verify` (`POST http://127.0.0.1:18081/verify`), which runs
the grader's **7 attack assertions** against live Postgres and returns
`{ "correct": boolean }`:

| # | assertion                                       | expected |
| - | ----------------------------------------------- | -------- |
| 1 | A-user GET own doc                              | 200      |
| 2 | A-user GET B-doc                                | blocked  |
| 3 | A-user PATCH B-doc                              | blocked  |
| 4 | A-user INSERT with B `org_id`                   | blocked  |
| 5 | member DELETE own doc                           | blocked  |
| 6 | owner DELETE own doc                            | succeeds |
| 7 | anon GET documents                              | blocked  |

All seven must pass. A correct fix scores 300 points; a wrong submission costs 10.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation template:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "DocumentsApi": "http://127.0.0.1:18080" },
  "verifyUrl": "http://127.0.0.1:18081/verify",
  "secretEnv": ["FLAG_SEED"]
},
"scoring": { "kind": "verify", "points": 300, "wrongAnswerPenalty": 10, "hints": [ … ] }
```

```
rls-tenant-isolation/
├── metadata.json                  # runtime (docker/compose) + scoring (verify) + hints
└── local/
    ├── docker-compose.yml         # one service, loopback-only ports + healthcheck
    ├── Dockerfile                 # postgres:16-alpine + node
    ├── entrypoint.sh              # boot pg, apply schema/seed, load policies, start app
    ├── app/
    │   ├── server.mjs             # vulnerable documents API (:8080) + /verify (:8081)
    │   ├── pg-client.mjs          # live Postgres adapter the grader drives (RLS-bound role)
    │   └── package.json           # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs              # the 7 attack assertions (pure, dependency-injected)
    │   └── grade.test.mjs         # unit tests with fake clients (bun test, no live DB)
    ├── db/
    │   ├── schema.sql             # tables + identity helpers + app_api role
    │   ├── seed.sql               # 2 orgs, 2 users each, multiple docs
    │   └── broken-policies.sql    # the vulnerable starting state (RLS disabled)
    ├── solution/
    │   └── policies.sql           # YOUR ANSWER (starts empty)
    └── reference/
        └── policies.sql           # reference answer key
```

## Run the grader unit tests

The grader's pass/fail logic is unit-tested with injected fakes — no live
Postgres, no network:

```bash
cd local/grader && bun test
```
