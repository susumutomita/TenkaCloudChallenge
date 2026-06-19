# ClickFix Incident — investigating a fake-verification breach

> TenkaCloud Challenge · `challenges/clickfix-incident` · difficulty 3 · ~45 min · flag scoring

## Story

TenkaCloud's spring campaign site is getting support tickets: *"the verification screen looks
fishy"*, *"my PC got slow after I 'verified'."*

You pull up the site and see it: a fake **Cloudflare Turnstile / reCAPTCHA** screen that tells visitors
to press **Win+R** and paste a command to "complete verification." That's an **ErrTraffic-style ClickFix
attack** — it abuses the user's own hands instead of an exploit. At least one visitor ran it, and
something got planted on the host.

Your job: investigate the compromised web host, reconstruct `fake verify → PowerShell → persistence`,
and recover the **campaign id** the attacker is exfiltrating.

> **Safe by construction:** no real malware, no C2, no PowerShell execution. The lure is a harmless
> mock, the PowerShell is a pseudo log, and the WordPress compromise is safe sample files. You only
> investigate.

## What gets deployed

| Resource | Role |
| --- | --- |
| **EC2 web host** (SSM-only, no public port) | Carries the breach evidence on disk. You reach it via SSM Session Manager. |
| **ParticipantViewerRole** | SSM Session Manager into the host + read your stack's SSM params. **No `cloudformation:DescribeStacks`** and **deny `ec2:DescribeInstanceAttribute`** — so the flag can't be read off the Output or the UserData; you must investigate. |

Evidence on the host:

```
/var/www/campaign/verify.html                          the fake Turnstile lure (ClickFix)
/var/log/clickfix/powershell_history.log               what the lured visitor pasted (EncodedCommand)
/var/log/clickfix/egress.log                           periodic beacons to the C2
/var/www/campaign/wp-content/mu-plugins/               WordPress must-use plugins (auto-loaded, hidden)
```

## How to solve

```bash
# 1. Connect to the compromised host (instance id is the WebHostInstanceId output)
aws ssm start-session --target <WebHostInstanceId>

# 2. See what the visitor was tricked into running (the EncodedCommand is base64)
cat /var/log/clickfix/powershell_history.log
echo '<the EncodedCommand base64>' | base64 -d        # -> it drops a wp mu-plugin

# 3. The dropped persistence is a must-use plugin (auto-loaded, invisible in wp-admin).
#    healthcheck.php / seo-tweaks.php are legit (decoys); cache-helper.php is the rogue one.
ls -la /var/www/campaign/wp-content/mu-plugins/
cat /var/www/campaign/wp-content/mu-plugins/cache-helper.php

# 4. Decode its base64 C2 config -> the exfiltrated campaign_id is the flag
grep -oP 'base64_decode\("\K[^"]+' /var/www/campaign/wp-content/mu-plugins/cache-helper.php | base64 -d
# -> {"c2":"verify-cdn-cache.example","campaign_id":"TC{…}", ...}
```

Submit the `campaign_id` value (`TC{…}`) in the Participant Portal.

> The campaign id is random per deploy and lives only inside the (base64-obfuscated) persistence
> artifact — you can't derive it from the NamePrefix or read it off any Output (discovered flag).

## Scoring

| | |
| --- | --- |
| Kind | `flag` (submit the `TC{…}` campaign id once) |
| Points | 300 |
| Wrong-answer penalty | −15 |
| Hints | 3 (−20 / −50 / −100): the lure + PowerShell trail → the mu-plugins persistence → decoding the artifact |

## Cost

One `t3.micro` EC2 (+ a minimal VPC for SSM). Within the free tier; `delete-stack` removes everything.

## Learning goals

- Explain the **ClickFix** flow — a fake reCAPTCHA/Turnstile that tricks a user into running a command
  as if it were a legitimate verification step (a real one never asks you to run anything).
- Investigate a compromised web host over SSM and detect anomalies from **PowerShell execution logs**,
  **egress logs**, and **WordPress `mu-plugins` persistence** (auto-loaded, hidden from the admin UI).
- Decode an **obfuscated (base64) C2 config** in a persistence artifact to identify what's exfiltrated.

## Related files

- [`template.yaml`](./template.yaml) — the compromised host, the planted evidence, and the participant role.
- [`metadata.json`](./metadata.json) — catalog entry, scoring, hints.
