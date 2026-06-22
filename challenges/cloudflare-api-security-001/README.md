# Self-deploy API Security — Verify an External URL (`cloudflare-api-security-001`)

No AWS account required. Publish your own profile API anywhere (Cloudflare
Workers, a container, any cloud), then hand its URL to the challenge's verifier.
A verifier Lambda (deployed by this problem) probes your API from the outside and
returns a flag once every requirement passes. The grading conditions live only
inside the verifier — this README is the public contract, nothing more.

## What you do

1. Publish an app that satisfies the contract below and note its `https://` URL.
2. Call the verify endpoint with your URL.
3. Read the failure summary, fix your API, redeploy, verify again.
4. When it passes, submit the returned `TC{...}` flag in the Portal.

Running your API locally is not enough: verification runs on the problem's Lambda,
from the outside, over HTTPS only.

## API contract (public)

| Method + path  | Expected behavior                         |
| -------------- | ----------------------------------------- |
| `GET /healthz` | `200` with a JSON body containing `ok`    |

More requirements (input validation, authorization, no information disclosure)
surface progressively in the verify response as you pass earlier checks.

## Verify

The verifier Function URL is the `VerifyUrl` stack output (also shown in the
Portal). Pass your app URL:

```bash
curl 'https://<VerifyUrl>/verify?url=https://<your-app>.workers.dev'
```

- Only `https://` URLs to public hosts are accepted (private / loopback / metadata
  addresses are rejected; redirects are not followed).
- A passing call returns `{ "ok": true, "flag": "TC{...}" }`. Submit that flag.

## Scoring

- Correct flag: **+200 pt** (once per deploy).
- Wrong submission: **-15 pt** each (never below 0).
- The flag is random per deploy and only obtainable by passing verification.
