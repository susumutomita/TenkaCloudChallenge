# Publishing Settings Left Behind

> TenkaCloud Challenge · `wix-exposure-audit` · difficulty 1 · ~40 min · `multi-verify`

An AWS-free, browser-completable audit of a mock SaaS-built business site. It
does not contact Wix or any other real SaaS and contains no real customer data.
The exercise covers four checkpoints: three independent exposure paths and one
stateful remediation check.

## Runtime and safety boundary

| Address | Purpose |
| --- | --- |
| `127.0.0.1:18080` | Published site and authorized owner settings |
| `127.0.0.1:18081` | Loopback-only `/verify` endpoint |

Docker binds both ports to loopback. Per-deploy flags and capability tokens are
derived from `FLAG_SEED`; no answer is committed to the repository.

## Scenario

Aoi Design Studio inherited its site from an outside production agency. The
managed site builder is functioning correctly, but three controls were never
cleaned up:

1. A client-review page remains in the public sitemap.
2. An "anyone with the link" customer-inbox URL remains in public HTML source.
3. The agency's Site manager access remains active after the contract ended.

These are separate control boundaries: publication scope, capability URLs, and
collaborator lifecycle. The final checkpoint verifies that the owner corrected
all three settings.

## Checkpoints

| ID | Evidence | Points |
| --- | --- | ---: |
| `preview-indexing` | Passphrase on the review page exposed by `sitemap.xml` | 20 |
| `shared-inbox` | Passphrase in the customer inbox reached through the leaked share URL | 20 |
| `stale-collaborator` | Passphrase on the still-active agency access page | 20 |
| `settings-remediation` | Confirmation passphrase the re-verification reveals after all three settings close | 40 |

Collect the first three passphrases before remediation. Closing the settings
intentionally removes access to their evidence. The final checkpoint is
order-gated: only once all three settings are closed does the re-verification
reveal a confirmation passphrase. Re-verifying or submitting before you finish
never gets you stuck (it is fully retryable), and no passphrase passes the
checkpoint until all three are genuinely closed.

## Audit path

1. Start the problem:

   ```sh
   make local PROBLEM=wix-exposure-audit
   ```

2. Inspect `http://127.0.0.1:18080/robots.txt`, then the referenced
   `sitemap.xml`. Follow the unexpected client-review URL.
3. View the HTML source of `/`. The production-agency comment contains a live
   `/admin/inbox?share=...` URL.
4. Inspect `/humans.txt`. Its handoff record points to the agency access URL.
5. Submit each `TC{...}` value to its matching Portal checkpoint.
6. Open `http://127.0.0.1:18080/owner/settings` as the authorized owner and:

   - disable preview indexing;
   - revoke the inbox share link;
   - remove the agency collaborator.

7. Once all three are closed, run
   `http://127.0.0.1:18080/owner/settings/reverify` (the owner-settings
   "re-verify" link) and submit the `TC{...}` confirmation passphrase it reveals
   to `settings-remediation`. If something is still open it just reports how many
   remain, so you can re-run it any number of times.

## Expected remediation behavior

After all settings are corrected:

- `sitemap.xml` no longer lists the review page, and the review route returns
  `404`;
- the old inbox share URL returns `403`;
- the old agency access URL returns `403`;
- `/owner/settings/reverify` confirms all three and reveals the confirmation
  passphrase (before that it only reports how many remain, and stays retryable),
  and `/verify` accepts that passphrase for the remediation checkpoint.

Restarting the container restores the deliberately vulnerable initial state and
generates a new set of flags.

## Why this matters

A managed SaaS removes infrastructure work, not the owner's responsibility for
access governance. Capability URLs remain valid until revoked, search engines
follow what a sitemap publishes, and outside collaborators retain their rights
until someone removes them. A pre-launch checklist must cover all three.

## Related files

- `local/app/server.mjs` — vulnerable surfaces, owner controls, and verifier
- `local/docker-compose.yml` / `local/Dockerfile` — loopback-only runtime
- `metadata.json` — bilingual checkpoint labels, hints, and scoring
