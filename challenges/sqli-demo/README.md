# sqli-demo — SQL Injection Login Bypass

A small, self-contained **local-play** Challenge for TenkaCloud. It runs entirely
in Docker — no AWS account, no cloud resources — and is the reference problem for
the container `/verify` scoring contract (#2054). Based on IPA "安全なウェブサイト
の作り方" §1.1 (SQL injection).

> Deliberately vulnerable training target. The compose file binds it to
> `127.0.0.1` only; never expose it off loopback.

## Play it

```bash
make local PROBLEM=sqli-demo   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** <http://127.0.0.1:18080> — an "Acme Staff Login" form.
- **Goal:** sign in as `admin` (you do **not** know the admin password), read the
  flag the admin view reveals, then submit it in the portal.

## How scoring works

The platform holds no answer. On submit, the local scoring API forwards your
submission to the container's loopback `/verify`
(`POST http://127.0.0.1:18081/verify`), which judges it and returns
`{ "correct": boolean }`. A correct flag scores 200 points; a wrong one costs 10.

The flag and the admin password are derived from a per-deploy random `FLAG_SEED`,
so every run is unique and nothing secret is committed.

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
"scoring": { "kind": "verify", "points": 200, "wrongAnswerPenalty": 10, "hints": [ … ] }
```

```
sqli-demo/
├── metadata.json            # runtime (docker/compose) + scoring (verify) + hints
└── local/
    ├── docker-compose.yml   # one service, loopback-only ports + healthcheck
    ├── Dockerfile           # node:22-alpine
    └── app/server.mjs       # vulnerable login (:8080) + /verify (:8081)
```
