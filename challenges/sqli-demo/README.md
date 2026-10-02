# sqli-demo — SQL Injection Login Bypass

A small, self-contained **local-play** Challenge for TenkaCloud. It runs entirely
in Docker — no AWS account, no cloud resources — and is the reference problem for
the container `/verify` scoring contract (#2054). Based on IPA "安全なウェブサイト
の作り方" §1.1 (SQL injection).

> Deliberately vulnerable training target. The compose file binds it to
> `127.0.0.1` only; never expose it off loopback.

## Play it

From the TenkaCloud integration release that unifies local hosting:

```bash
make local
```

1. Open the printed organizer URL and finish organizer setup/sign-in.
2. Create an event with this problem and your teams, prepare access, and start the event.
3. Give each team its own join link/key. In Participant Portal, choose this problem and **Start / resume**.
4. Open **Web** from the protected Access URLs. The host assigns a separate environment and URL to each team; do not use a fixed port from this README.
5. Sign in as `admin` without knowing the password, then submit the passphrase in the portal.

`make down` stops local hosting and preserves the event, scores and unfinished work.
Start hosting again and resume the exercise to continue. Explicit problem teardown deletes
its containers and volumes. Older platform releases use their own pinned documentation.

## How scoring works

The platform holds no answer. On submit, the local scoring API forwards your
submission to the container's loopback `/verify`
(`POST http://127.0.0.1:18081/verify`), which judges it and returns
`{ "correct": boolean }`. A correct flag scores 100 points; a wrong one costs 5. Hint penalties also apply,
and the score can become negative.

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
"scoring": { "kind": "verify", "points": 100, "wrongAnswerPenalty": 5, "hints": [ … ] }
```

```
sqli-demo/
├── metadata.json            # runtime (docker/compose) + scoring (verify) + hints
└── local/
    ├── docker-compose.yml   # one service, loopback-only ports + healthcheck
    ├── Dockerfile           # node:22-alpine
    └── app/server.mjs       # vulnerable login (:8080) + /verify (:8081)
```
