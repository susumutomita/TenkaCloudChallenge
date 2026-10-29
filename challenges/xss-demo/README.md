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

- **Challenge surface:** <http://127.0.0.1:18080> — Japanese "スタッフ掲示板" with in-board
  **巡回を依頼** (`POST /admin/report`) and **受信ログ** (`GET /admin/captured`) controls.
- **Goal:** post a note, request a review from the board, read the capture log, and submit
  only the `TC{...}` passphrase to the portal (no `session=` / `flag=` prefix).

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
