# csrf-demo — Cross-Site Request Forgery Against a Settings Endpoint

A small, self-contained **local-play** Challenge for TenkaCloud. It runs entirely
in Docker — no AWS account, no cloud resources — and exercises the same container
`/verify` scoring contract (#2054) as `sqli-demo`/`xss-demo`. Based on IPA "安全な
ウェブサイトの作り方" §1.6 (cross-site request forgery).

> Deliberately vulnerable training target. The compose file binds it to
> `127.0.0.1` only; never expose it off loopback.

## Play it

```bash
make local PROBLEM=csrf-demo   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** <http://127.0.0.1:18080> — an "Acme Security — Report a
  Suspicious Page" inbox.
- **Goal:** the settings endpoint (`POST /settings/email`) checks only that a
  valid admin session is attached — never that the request was actually
  intended by the admin. Report a page containing an auto-submitting form
  targeting that endpoint; when the simulated reviewer (already signed in)
  "opens" your report via `POST /admin/review-reports`, their session submits
  it for you. Read the flag from `GET /admin/notification-status`.

## How scoring works

The platform holds no answer. On submit, the local scoring API forwards your
submission to the container's loopback `/verify`
(`POST http://127.0.0.1:18081/verify`), which judges it and returns
`{ "correct": boolean }`. A correct flag scores 100 points; a wrong one costs 5.

The flag is derived from a per-deploy random `FLAG_SEED`, so every run is unique
and nothing secret is committed. The admin's session token is never exposed by
any route — the flag is reachable only by actually forging the request through
the simulated reviewer, not by calling the settings endpoint directly.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation template:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Web": "http://127.0.0.1:18080" },
  "verifyUrl": "http://127.0.0.1:18081/verify",
  "secretEnv": ["FLAG_SEED"]
},
"scoring": { "kind": "verify", "points": 100, "wrongAnswerPenalty": 5, "hints": [ … ] }
```

```
csrf-demo/
├── metadata.json            # runtime (docker/compose) + scoring (verify) + hints + track
└── local/
    ├── docker-compose.yml   # one service, loopback-only ports + healthcheck
    ├── Dockerfile           # node:22-alpine
    └── app/server.mjs       # vulnerable settings endpoint (:8080) + /verify (:8081)
```
