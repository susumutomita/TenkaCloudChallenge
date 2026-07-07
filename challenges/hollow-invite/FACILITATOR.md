# Operation "Hollow Invite" — Facilitator guide

> Operator/facilitator-facing. Reading this as a participant spoils the exercise.
> All entities are fictional; the whole scenario runs inside one isolated tenant.

This is a team-based incident-response GameDay. The portal **auto-scores four
discovery flags** (the `multi-verify` checkpoints in `metadata.json`). The richer
**100-point GameDay rubric below is scored by you, the facilitator** — it rewards
the reasoning and the deliverables the portal cannot grade.

## Pre-event checklist

```bash
# 1. Safety invariants (reserved TLDs only / no egress / no real payload):
node local/safety-check.mjs         # the `make harness` equivalent — must print OK

# 2. Boot the tenant and smoke-test:
FLAG_SEED=rehearsal node local/app/server.mjs &
curl -s localhost:8080/healthz
curl -s localhost:8080/rdap/domain/northgate-cowork.example   # note the registration date
curl -s -X POST localhost:8081/verify -H 'content-type: application/json' \
  -d '{"checkpointId":"dkim-domain","submission":"northgate-cowork.example"}'
```

`make local PROBLEM=hollow-invite` (platform repo) injects a random `FLAG_SEED`
and binds everything to `127.0.0.1`.

## Fictional entities (reserved TLDs only)

| Role | Value |
| --- | --- |
| Victim org | Kestrel Dynamics 合同会社 (`kestrel-dyn.example`) |
| Reporting employee | Aoi Tanaka `a.tanaka@kestrel-dyn.example` |
| Second recipient (T+30) | Sora Mori `s.mori@kestrel-dyn.example` |
| Impersonated company | Northgate Cowork (`northgate-cowork.example`, hijacked/re-registered) |
| Impersonated person | Daniel Whitmore (claimed co-founder) |
| Sender | `general@northgate-cowork.example` |
| Fake meeting app | Vela Meet |
| Attacker lure domain | `velameet-07.example` |
| Meeting URL | `https://velameet-07.example/room/qrt-mkbd-zol` |

## Run-of-show (90–120 min: intro 10 / play 75–90 / debrief 20)

Release each inject by handing out an artifact or announcing the update. Timings
are guidance — pace to the room.

- **T+0 — kickoff.** Distribute `hollow-invite.eml`. Ask Aoi (played by you)
  whether she clicked / downloaded / entered anything / signed / ran anything.
  **Canonical answer: she did NOT click the link.** Have teams set a provisional
  severity.
- **T+15 — domain lookups.** Point teams at the mock RDAP (`GET
  /rdap/domain/<name>`). They should compare `northgate-cowork.example` (recent)
  with the company's claim to be established, and with `velameet-07.example`
  (newer still). This unlocks **OBJ-1 / FLAG-1**.
- **T+30 — second recipient.** Announce that Sora also received the same subject.
  **Sora opened the link but did NOT install the app, run a file, enter data, or
  sign anything.** Have teams contrast *viewing only* vs *execute / input / sign*.
- **T+45 — network log.** Distribute `proxylog.jsonl` (or point to
  `/artifacts/proxylog.jsonl`). It shows the reach to `velameet-07.example`, the
  periodic `POST /api/heartbeat`, the `velameet-join://` launch attempt, and the
  dynamic `POST /meetings/<id>/download`. Move teams into static analysis of
  `clone/app.js` → **OBJ-3 / FLAG-3** and **BONUS-3b**.
- **T+60 — executive query.** Ask, in character: "What is the impact to our
  clients? Is Northgate Cowork real? Was anything leaked internally?" Teams draft
  an executive answer separating **fact / hypothesis / unconfirmed**.
- **T+75 — convergence.** Teams finalize IOCs and decide block / notify / notify
  the impersonated company / external report. **OBJ-4 / FLAG-4.**

## Answer key (the four portal checkpoints)

| Check id | What / where | Expected finding |
| --- | --- | --- |
| `domain-age` (FLAG-1) | `GET /rdap/domain/northgate-cowork.example`, `registration` event | **Per-deploy** — the date the mock returns (reference `FLAG_SEED=test-seed-42` → `2026-04-28`; yours differs). |
| `dkim-domain` (FLAG-2) | `.eml` `DKIM-Signature` `d=` (and `Authentication-Results`) | `northgate-cowork.example` |
| `download-path` (FLAG-3) | `clone/app.js` `requestDesktopHelper()` | `/meetings/{id}/download` (concrete room id also accepted) |
| `impersonator` (FLAG-4) | `.eml` `From`/signature and `GET /api/meetings/<id>` organizer | `Daniel Whitmore` |

The `/verify` grader is lenient: it accepts the bare value or a `FLAG{...}` /
`TC{...}` wrapper, and for the path it accepts the `{id}` pattern or the concrete
room id.

**BONUS-3b (facilitator-scored):** in `proxylog.jsonl` Sora's download returned
`payload: "none"` and pulled an empty body, and the live mock returns the benign
marker only for a *matched* OS. Award the bonus when a team explains that
`none` / "nothing landed on my machine" is **not** proof of safety — the
attacker serves builds conditionally (OS/client), so another victim gets the
real thing. Deduct if a team calls the campaign harmless on that basis.

## GameDay rubric (100 pts, facilitator-scored)

| Item | Points |
| --- | ---: |
| FLAG-1〜4 (portal auto-scores these; mirror the credit here) | 40 |
| BONUS-3b — `curl:none` is "not loaded", not proof of safety | 5 |
| Argue the domain takeover (recent registration vs claimed company) | 15 |
| Articulate the limits of authentication (what SPF/DKIM/DMARC pass does and does not guarantee) | 10 |
| Blast-radius judgment (viewed-only vs execute/input/sign; who is affected) | 10 |
| IOC list + reporting deliverables (internal notice, notice to the impersonated company, external report) | 15 |
| IC operation / timeline discipline | 5 |

**Deduction traps** (apply once each):

- Calling the sample harmless on `curl:none` alone: **−10**.
- Declaring the message legitimate because SPF/DKIM/DMARC all pass: **−10**.

Note: the portal's `multi-verify` total (200, tier-normalized for the catalog
leaderboard) is a *separate* number from this 100-point GameDay rubric. Use the
portal for the flags and this rubric for the debrief; do not add them.

## Expected IOCs (for grading the IOC list)

- Sender: `general@northgate-cowork.example`; hijacked domain `northgate-cowork.example` (registered recently per RDAP).
- Lure domain `velameet-07.example`; meeting URL `https://velameet-07.example/room/qrt-mkbd-zol`.
- Custom protocol `velameet-join://join?room=…`.
- Beacon `POST /api/heartbeat`; dynamic delivery `POST /meetings/{id}/download`; conditional `payload` by OS.
- Impersonated identity: Daniel Whitmore, "Co-Founder, Northgate Cowork".

## Debrief — the key message

> Authentication, a real name, a real-looking company, and TLS together are **not
> sufficient** for legitimacy. Evaluate the trust of a business conversation and
> the trust of a URL that asks you to meet / log in / download / sign
> **separately**. Do not click unknown links; verify identity over a known,
> independent channel. Authentication results help you *prove impersonation* —
> they are never proof of legitimacy.

Prompts: Where did each team's severity change, and on what evidence? Which teams
separated "authenticated" from "legitimate"? Who fell for `payload:"none"`? What
would have caught this before Sora opened the link (independent verification,
link-handling policy)?

## Safety invariants (must hold)

- Only `.example` and `*.tenka.local`; no external egress; no real payload.
- The clone contains no external URL, real org name, real malware, or real
  binary. `node local/safety-check.mjs` enforces the URL/payload invariants;
  re-run it after any edit to the tenant.
