# Question the Limit-Up Landing Page

**Draft — Docker run not yet verified.** The problem's unit and HTTP tests and the catalog gate pass, but the Compose stack has not been built or started on a Docker host. Run the Docker smoke test below before setting `status` to `ready`.

A defender-side analysis exercise themed on the overheated market for "AI security" stocks. A fictional vendor, Kagero Shield, hits limit-up on hype; a free "security diagnosis" offer in its name reaches the accounting team of the fictional Hinata Foods. Participants play the in-house security person: they read the vendor's landing page (LP) and the material a colleague forwarded, and prove each trust trick and social-engineering step with a value they can only find by cross-checking.

Every company, person, product, certification body and domain is fictional; all domains use the reserved `.example` TLD. Nothing names a real company, stock or brand.

## Participant route and scoring evidence

`scoring.kind` is `multi-verify`: six checkpoints, 100 points in total (Easy tier), 1 point per wrong answer, two hints each (48 points across all hints, under the 50% cap).

| Checkpoint | Trick | Where the evidence is | Submitted value |
| --- | --- | --- | --- |
| `campaign-timer` (15) | Countdown urgency | The LP timer restarts from the same value on every load | Minutes the countdown starts from |
| `customer-count` (15) | Inflated count, logos, hidden fine print, misleading stats | Footnotes in near-background colour point to `/ir` | Paid-customer count from IR |
| `cert-badges` (15) | Fake certification badge | `/evidence/registry.html` lists one badge number under another company and scheme | That badge's registration number |
| `customer-voices` (15) | Fake testimonials | Two "customers" share one stock portrait, `/assets/stock/<id>.svg` | The 4-digit stock id |
| `support-line` (20) | Fake support chat and phone | LP chat and `/evidence/chat-log.txt` vs `/company` and `/ir` | The unpublished phone number |
| `mail-sender` (20) | Pretexting email, typosquatted domain, credential-harvesting form | `/evidence/mail.eml` From/Reply-To, the form's hidden `relay` field, `/evidence/whois.txt`, `/ir` | The lookalike domain |

The timer is earnable from the first screen (low floor). The email checkpoint needs headers, whois and the official-domain statement read together. Vague "AI" and "99.9%" claims are covered in the footnotes and the writeup but are not separately scored.

## Components

- `local/app/scenario.mjs`: derives every per-run value (minutes, paid count, badge numbers and which one is fake, stock ids, phone numbers, lookalike domain) from `FLAG_SEED` with HMAC-SHA256. No answer or default seed is committed; a missing or malformed seed stops startup.
- `local/app/site.mjs`: participant surface on `:8080`. Serves the LP, `/company`, `/ir`, `/evidence/` (email, chat log, registry copy, whois) and the portraits. No user input is reflected.
- `local/app/verifier.mjs`: separate container on `:8081`. Accepts `{ checkpointId, submission, context }` at `POST /verify` and returns `{ checkpointId, correct, message }`. Unknown checkpoints and malformed bodies get a 4xx. The message never carries the expected value. Spelling variants (full-width digits, `23分`, `00:23:00`, a URL or email address containing the domain) are normalised.
- `local/Dockerfile`: two targets. The `challenge` image copies only `scenario.mjs` and `site.mjs`; the verifier, tests, metadata and writeup stay out of it.
- `local/tests/site.test.mjs`: solves all six checkpoints from the HTTP surface across several seeds, checks accepted spellings, decoy rejection, the form's no-store behaviour and the `.example`-only rule.

## Safety boundary

- The "free diagnosis" form is the credential-harvesting lure under study, not a working kit. It posts only to `/diagnosis` on the same container, which drains and discards the body (max 16 KiB) without logging, storing, echoing or forwarding it, and answers with a training notice. The hidden `relay` field is inert text pointing at a fictional `.example` host.
- Every page shows a training banner saying not to enter real credentials or personal data; inputs carry the same placeholder.
- Compose binds both ports to `127.0.0.1`, runs as the non-root `node` user with a read-only root, dropped capabilities, `no-new-privileges`, resource limits and health checks. No volumes, host mounts or Docker socket.

## Run through TenkaCloud

Select this catalog revision with TenkaCloud's catalog-source configuration (`CATALOG_SOURCES=my-catalogs.json make local`), create an event containing this problem, and start it from Participant Portal. Open the **Web** access URL. Docker Engine with Compose is required. The platform assigns ports and injects `FLAG_SEED`; do not distribute the fixed development ports.

## Local verification

From the repository root (Node 22 or newer):

```bash
make install
make agent-gate
node --test challenges/security-hype-lp/local/tests/site.test.mjs
```

The tests use synthetic seeds and ephemeral loopback listeners; no browser, Docker, cloud or real secret is needed.

Docker smoke test (not yet run for this PR):

```bash
cd challenges/security-hype-lp/local
export FLAG_SEED="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
docker compose up --build -d --wait
curl -fsS http://127.0.0.1:18080/ | grep -q 'カゲロウシールド'
curl -fsS -X POST http://127.0.0.1:18081/verify -H 'content-type: application/json' \
  -d '{"checkpointId":"campaign-timer","submission":"0"}'   # expect "correct":false
docker compose down
unset FLAG_SEED
```

## Resources, cost and teardown

No AWS or other cloud resources, no Region. Two local containers, each limited to 128 MiB, 0.5 CPU and 32 processes, plus two loopback ports. Building pulls the pinned Node image. Budget 40 minutes per session. There are no persistent volumes: `docker compose down` (or TenkaCloud's problem teardown) removes everything. Restarting with the same seed keeps the same answers.
