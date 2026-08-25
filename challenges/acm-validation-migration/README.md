# Keep the certificate ARN. Switch only the validation method

**Order:** standalone (no track) · **Difficulty:** 3 (intermediate) · **Time:** 45–60 minutes ·
**Points:** 200 · **Runtime:** Python standard library only (offline simulator, no real AWS)

## Before you start — from school math

- **What you already know**: the "correspondence table" from middle-school linear functions ties
  one x to exactly one y (x=1 gives y=4, x=2 gives y=6, and so on). The inequality work from the
  same years turns "finish within 5 hours of starting at 9" into 9+5=14, i.e. "finish time ≤ 14".
  And "everyone in the class" versus "just today's two duty officers" is the everyday version of a
  set and a subset: a smaller group picked out of a larger one. This lab maps exactly those three
  ideas — correspondence, inequality, subset — onto migrating an AWS certificate.
- **Where in the course**: this matches middle-school linear functions and simultaneous equations
  for the correspondence idea, middle-school inequalities for the deadline, and the subset idea
  from a first course in sets. No further prerequisite is assumed.
- **A one-digit example**: in the table x=1→y=4, x=2→y=6, x=3→y=8, writing x=1's value 4 on the
  x=2 row breaks the table — matching each certificate domain to its own correct CNAME value is
  the same idea. Starting at 9 and finishing within 5 hours means finishing by 9+5=14; 14 itself
  is safe (14≤14), 15 is not (15>14) — migrating within 72 hours is the same time-difference
  inequality. Out of 5 students {A,B,C,D,E}, only B and D are today's duty officers; granting the
  duty officers' permission to all 5 is broader than the 2-person subset that is actually needed —
  DNS write access should be scoped the same way, to only the zones and records actually needed.
- **Words**: a correspondence (table) fixes exactly one correct output for each input. An
  inequality expresses "within N hours" as a comparison of numbers. A set is a collection of
  things; a subset is a smaller collection picked out of it. ARN = a certificate's unchanging name
  (identifier). SAN = an additional domain name one certificate covers. CNAME = the DNS record
  that proves you control a domain. Hosted zone = wherever a domain's DNS records are actually
  managed. Least privilege = scoping access to only the necessary subset.

## Why this matters

AWS now lets an existing ACM certificate switch validation method (email → DNS), and is retiring
email validation: no new issuance after 2027-03-31, no renewal after 2027-09-30. The migration
must happen before that deadline, but reissuing a certificate mints a new ARN and forces every
consumer that references it (an ALB listener, a CloudFront distribution, an API Gateway custom
domain) to be repointed. This lab implements a migration that **keeps the ARN and switches only
the validation method**.

```mermaid
sequenceDiagram
    participant M as migrate_step (tick)
    participant ACM as ACM (fake)
    participant R53 as Route 53 (fake)
    participant Clock as clock
    M->>ACM: UpdateCertificateOptions(arn, DNS)
    ACM-->>M: same ARN, method=DNS
    M->>R53: ChangeResourceRecordSets(zone, UPSERT, CNAME)
    Note over R53: one CNAME per SAN; the zone can differ per domain
    Clock->>Clock: time passes (propagation)
    M->>ACM: ListCertificateDomainValidations(arn)
    ACM-->>M: each domain's status
    alt every domain SUCCESS
        M-->>M: done: true
    else past 72h with a domain still PENDING/FAILED
        M-->>M: aborted: true
    else still in progress
        M-->>M: done: false, aborted: false (called again next tick)
    end
```

## Participant-visible contract

Edit `migration.py`. It must define:

```python
migrate_step(client) -> {"certificates": {"<arn>": {"done": bool, "aborted": bool}, ...}}
```

`migrate_step` represents one scheduler tick. The Portal and the hidden verifier call it
**repeatedly, advancing a simulated clock between calls** (there is no real sleeping). Each call
must be idempotent, and must return one entry for **every** certificate
`client.list_certificates()` currently reports.

Key methods on `client`:

- `list_certificates()` / `describe_certificate(arn)` / `list_certificate_domain_validations(arn)`
- `hosted_zone_for_domain(domain)` — the hosted zone that actually manages that domain
- `update_certificate_options(arn, "DNS")` — switches method without changing the ARN
- `declare_dns_write_policy(statements)` — declares the DNS write access this migration uses
  (a list of statements with `Effect`/`Action`/`Resource`; writing to an undeclared zone raises
  `AccessDenied`)
- `change_resource_record_sets(zone_id, "UPSERT", name, "CNAME", value)` — idempotently writes a
  CNAME (`"CREATE"` on an existing record fails, matching real Route 53)
- `now()` — the current simulated time in seconds. Once more than 72 hours
  (`fixtures.aws_lab.DEADLINE_SECONDS`) have passed since the certificate's method switch
  (`optionsUpdatedAt`), stop issuing writes for it
- `call_log()` / `debug_policy()` / `debug_validation_state(arn)` — inspect your own call history,
  declared policy, and each domain's internal state (nothing here is a hidden secret)

`request_certificate(...)` and `delete_certificate(arn)` also exist, but **must never be called**.
Like the real API, the call itself succeeds — it replaces the certificate's identity, and the
`preserve-identity` checkpoint catches it.

## The intentionally incomplete public tests

The shipped starter passes all public tests. They only cover the simplest scenario — one domain,
one hosted zone, fast convergence — and never check multiple SANs, a delegated zone (a hosted zone
owned by someone else), the 72-hour deadline, or what "done" should actually mean.

The hidden checkpoints add one property at a time.

- `preserve-identity`: never replace the certificate ARN, and never change a consumer's reference.
- `publish-records`: deliver every SAN's correct CNAME to its correct hosted zone.
- `least-privilege`: the declared policy matches exactly the set of zones actually used.
- `deadline-retry`: a slow-propagating domain still converges within 72 hours, a duplicate retry
  never errors, and writes stop once the 72-hour deadline has passed.
- `verify-renewal`: never trust the returned claim — **re-query** `describe_certificate` and
  `list_certificate_domain_validations` to confirm every domain is SUCCESS and the certificate is
  renewal-eligible.

This public/hidden gap is the exercise. A green public test suite proves none of these properties.

## Participant Portal workflow

1. Start the problem; the editor and evidence controls appear on the problem page.
2. Select **Inspect evidence** to read this deployment's certificate inventory, SANs, dependents,
   and DNS owners.
3. Edit `migration.py` and run the public tests.
4. Answer the `inventory` checkpoint directly as JSON, derived from the evidence.
5. Submit the other five checkpoints. Portal sends the current editor contents through
   `/api/prepare` and `/verify`.

The Workbench and hidden verifier are different containers. Only the Workbench is published, on
`127.0.0.1:18620`; it forwards verification over a Compose-internal network.

## Local workflow

These commands require a host terminal with Docker:

```bash
make inspect          # certificate inventory, SANs, dependents, DNS owners
make test             # public tests; the starter passes
make test-one ID=...  # one public test by name substring
make up               # Workbench on http://127.0.0.1:18620
make down
```

Authors and CI only:

```bash
make reference-test   # reference + hidden properties + nine killed mutations
```

## Checkpoints

| id | points | asks |
| --- | ---: | --- |
| `inventory` | 20 | enumerate every certificate, SAN, dependent ARN, DNS owner (direct JSON answer) |
| `preserve-identity` | 35 | never replace the certificate ARN |
| `publish-records` | 40 | idempotently publish every domain's correct CNAME into its correct zone |
| `least-privilege` | 30 | scope DNS write access to only the zones/records needed |
| `deadline-retry` | 30 | treat the 72-hour deadline, partial failure, and retry/abort as a state machine |
| `verify-renewal` | 45 | confirm every domain validated and renewal eligibility from external state |

`preserve-identity`, `publish-records`, and `verify-renewal` all passing, together with a total of
160/200 or more, is the bar for treating this migration as "complete". The untouched starter does
not clear it: for any certificate that also carries SANs, it calls `request_certificate` as a
"clean slate" instead of trusting `update_certificate_options` alone, so `preserve-identity` fails
outright; `publish-records` fails too (a delegated SAN's record lands in the wrong zone), and so
does `verify-renewal` (it reports done without confirming validation).

## Assurance scope

Local mode is self-paced, honor-system verification. The participant owns the machine, the Docker
daemon, and the image. The normal participant image does not contain hidden tests, the reference,
or mutations; the hidden verifier is a separate image. A person who controls Docker can still
build author stages and inspect them. The separation prevents accidental delivery, not a malicious
host owner. Submissions run with time, memory, process, and output caps; containers run non-root,
read-only, without privileges, and without a masqueraded outbound network.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not reissue the certificate. You switched its validation method on the same ARN, delivered
every SAN's correct record to its correct DNS owner, and confirmed — from external state, within
72 hours — that every domain validated and the certificate is renewal-eligible. That is a precise,
useful guarantee, and no larger than the evidence supports.
