# xss-demo — Stored XSS Session Theft

A small, self-contained **local-play** Challenge for TenkaCloud. It runs entirely
in Docker — no AWS account, no cloud resources — and exercises the same container
`/verify` scoring contract (#2054) as `sqli-demo`. Based on IPA "安全なウェブサイト
の作り方" §1.5 (cross-site scripting).

> Deliberately vulnerable training target. The compose file binds it to
> `127.0.0.1` only; never expose it off loopback.

## Play it

```bash
make local PROBLEM=xss-demo   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** <http://127.0.0.1:18080> — an "Acme Staff Bulletin Board".
- **Goal:** anyone can post a note; a simulated security reviewer checks new posts
  via `POST /admin/report`. Get the reviewer's session to leak through a post's
  contents, read it back from `GET /admin/captured`, then submit the flag it
  reveals in the portal.

## How scoring works

The platform holds no answer. On submit, the local scoring API forwards your
submission to the container's loopback `/verify`
(`POST http://127.0.0.1:18081/verify`), which judges it and returns
`{ "correct": boolean }`. A correct flag scores 100 points; a wrong one costs 5.

The flag is derived from a per-deploy random `FLAG_SEED`, so every run is unique
and nothing secret is committed.

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
xss-demo/
├── metadata.json            # runtime (docker/compose) + scoring (verify) + hints
└── local/
    ├── docker-compose.yml   # one service, loopback-only ports + healthcheck
    ├── Dockerfile           # node:22-alpine
    └── app/server.mjs       # vulnerable board (:8080) + /verify (:8081)
```
