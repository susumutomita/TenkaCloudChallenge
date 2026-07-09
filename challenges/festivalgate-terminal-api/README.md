# Trust Boundaries at the Entrance Terminal

> TenkaCloud Challenge · `festivalgate-terminal-api` · difficulty 3 · ~60 min · `multi-verify`

An AWS-free local API-security exercise covering four independent control gaps
and one stateful remediation checkpoint. The service is fictional, uses only
synthetic records, and runs in one Docker container.

## Runtime and safety boundary

| Address | Purpose |
| --- | --- |
| `127.0.0.1:18080` | Terminal API and authorized owner-security settings |
| `127.0.0.1:18081` | Loopback-only `/verify` endpoint |

Docker exposes both listeners only on loopback. The terminal credential, staff
PIN, and checkpoint flags are derived from a fresh `FLAG_SEED` on every deploy.

## Scenario

FestivalGate terminals should only look up tickets and check attendees in. The
implementation nevertheless relies on four unsafe assumptions:

1. a client-supplied proxy header proves that a request is internal;
2. an operations summary may return customer counts and secrets "for
   convenience";
3. the terminal identity may use the same broad data connection as operations;
4. a three-digit support PIN is safe without an attempt limit.

The exercise scores these as separate findings. The final checkpoint verifies
the corrected server state, not a self-reported answer.

## Checkpoints

| ID | Evidence | Points |
| --- | --- | ---: |
| `proxy-boundary` | Audit marker returned after bypassing the claimed internal boundary | 40 |
| `response-scope` | Audit marker among excessive operations-summary fields | 40 |
| `terminal-data-scope` | Audit marker in a customer record reachable by the terminal identity | 40 |
| `attempt-throttling` | Audit marker returned after an unthrottled PIN search | 40 |
| `security-remediation` | Hidden check of all five defensive settings | 40 |

Collect the first four passphrases before remediation; the fixes intentionally
remove those access paths.

## Audit path

1. Start the problem:

   ```sh
   make local PROBLEM=festivalgate-terminal-api
   ```

2. Open `http://127.0.0.1:18080/`. It provides the assigned low-privilege
   terminal token and the documented ticket operations.
3. Call `/internal/ops/status` without special headers. From the `403`, determine
   what request value the server might use for its internal/external decision.
4. Test a client-supplied internal-looking first hop against both
   `/internal/ops/status` and `/internal/ops/summary`. The latter returns far
   more than an operational status needs.
5. Following the profile entry point noted in the problem instructions, open a
   customer record by id with the terminal token (for example
   `/api/terminal/customers/1`). The small integer IDs on the neighboring
   `/api/terminal/customers/<id>` collection are enumerable — compare each
   record's name and role to find the one that stands out.
6. Test the documented three-digit
   `/api/terminal/staff-unlock?pin=000` workflow. Before remediation, repeated
   wrong attempts are never throttled.
7. Submit the four `TC{...}` values to their matching Portal rows.
8. Open `/owner/security` and correct every row:

   - stop treating a client header as identity;
   - minimize the operations response;
   - remove customer-data access from the terminal identity;
   - enable PIN attempt control;
   - separate operations secrets from the terminal service.

9. Submit `VERIFY` to `security-remediation`.

## Expected remediation behavior

After the owner applies all controls:

- forged `X-Forwarded-For` values no longer open either operations endpoint;
- the terminal customer-data endpoint returns `403`;
- three wrong PIN attempts cause later attempts to return `429`;
- operations secrets are separated from the summary's data path;
- the remediation checkpoint accepts `VERIFY`.

Restarting the container restores the deliberately vulnerable initial state and
rotates every generated credential and flag.

## Root-cause lessons

- A network boundary is defense in depth, not authentication. Trust only proxy
  metadata established by a controlled hop, and authenticate each endpoint.
- Return only fields required by the operation. A successful authorization
  decision is not permission to disclose an entire backing record.
- Give a terminal service identity access only to ticket operations. Keep
  customer and operations secrets behind separate identities and data stores.
- Low-entropy credentials require rate limits, lockout policy, monitoring, and a
  stronger primary authentication mechanism.

## Related files

- `local/app/server.mjs` — API surfaces, owner controls, SQLite data, verifier
- `local/docker-compose.yml` / `local/Dockerfile` — loopback-only runtime
- `metadata.json` — bilingual checkpoint labels, hints, and scoring
