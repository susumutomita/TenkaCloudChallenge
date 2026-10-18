# Visitor Cards: Ready to Ship?

**Draft — deployment review required.** On the validation host (Docker Engine29.6.1 / Compose5.3.1), the two internal-network services became healthy but did not publish usable host ports (`NetworkSettings.Ports` was null). Do not schedule this problem in a live event until the platform ingress path is verified without weakening internal networking. Internal HTTP verification is separate from Portal/host-port reachability.

An introductory investigation for the new maintainer of reception's visitor-card
preview. Punctuation sometimes breaks it; another input reportedly added a line.
Decide whether this is merely a display defect or a release-blocking disclosure.
The opening brief does not name the injection mechanism or the private setting key.

Players first observe the normal UI, then follow its **Maintainer handover** link.
That page exposes the actual string-building fragment, the complete small-language
reference, and a settings inventory with a public value and a private value omitted.
Nothing requires guessing a hidden route or undocumented syntax. A controlled sequence
can distinguish ordinary punctuation, broken quoting, evaluated concatenation, extra
output, a public-setting read and the impact on a private operational code.

Completion requires a normal/changed-input comparison, the recovered code and a short
cause/repair explanation supported by observations. The code earns 100 points; a wrong
submission costs 5. Hints cost 20/30. **Only the code is automatically scored.** Keep the
reasoning in exercise notes for organizer review; no automatic prose grading is claimed.

## Run through TenkaCloud

Select this catalog revision with the platform's supported catalog-source configuration.
Run `make local` in TenkaCloud, create an event containing this problem, distribute team
keys, and start/resume the problem from Participant Portal. Open the protected **Web**
access URL. The platform assigns each team's ports and secret; do not distribute the
fixed development ports below. Follow the platform's current setup/network requirements.

This uses the existing Docker Compose + `verify` adapter, not the native runner.
Docker Engine/Compose is required. Codespaces native public mode excludes Compose
problems. Remote Compose needs the platform's supported native Linux isolation;
loopback bindings alone do not certify participant-device or household-LAN isolation.
Do not change VPN/firewall settings or expose the verifier to make this problem work.

## Components and safety boundary

- `local/app/lab.mjs`: participant HTTP page and a deliberately limited interpreter.
  The front page is a normal name/preview UI; the linked `/handover` page contains implementation and language clues. It builds `print("Hello, <name>!");` by unsafe string concatenation. The interpreter
  supports only strings, `+`, `print` and two allowlisted dictionary keys. No JavaScript
  eval/Function/vm, property traversal, OS environment access, filesystem, shell, network
  or memory-reading capability is available to submitted programs. Limits apply to
  input, statements, atoms and output. The page escapes HTML separately.
- The teaching `env` dictionary contains public `COLOR` and fictional `FLAG`. It is
  **not `process.env`**. Only the injected `FLAG_SEED` is read during startup, validated,
  used to derive a domain-separated HMAC flag, and removed from the process environment.
  There is no committed/default flag or seed. Never inject production credentials.
- `local/app/verifier.mjs`: a separate container accepts `{ "submission": "..." }` at
  POST `/verify` and returns only `{ "correct": boolean }`; wrong answers reveal no
  expected value. It independently derives this environment's answer from the seed.
- Compose uses two separate internal networks, loopback-only published ports, non-root
  processes, read-only roots, dropped capabilities, no privilege escalation, resource
  limits and health checks. There are no host mounts or Docker socket. The participant
  image copies only `lab.mjs`: no verifier, tests, metadata, writeup or reference answer.

This is a **bounded teaching simulation**, not a general-purpose code sandbox. It
illustrates code injection into a small language. It does not read real environment
secrets, dump memory, exploit a kernel, or execute arbitrary JavaScript. Do not replace
it with `eval` or attach host resources. These configuration/code boundaries have unit
and HTTP tests; live Docker/network enforcement is a separate rehearsal.

## Cause, answer route and repair (author notes)

The writeup in `metadata.json` explains the quote/statement injection that reads the
fictional dictionary value. Keep it and the reference payload in the tests out of the
participant image. Reading that value is ordinary evaluation of an added statement,
not a memory dump.

The safe implementation is `safeGreeting(name)`: build a greeting as data, without
constructing or interpreting code. It does not rely on filtering suspicious words or
quote escaping. The same injected name then stays literal and reveals no flag. HTML
escaping remains independently necessary. `local/tests/lab.test.mjs` verifies both the
intentional flaw and this repair, unsupported capabilities, bounds and scoring failure.

## Verification

From this repository's root:

```bash
make install
make agent-gate
node --test challenges/greeting-expression-lab/local/tests/lab.test.mjs
```

Use Node 22 or newer for the problem tests (the image uses Node 22). Tests use only
synthetic seeds and ephemeral loopback listeners. No browser, Docker, AWS or real secret
is needed. The HTTP tests follow the visible handover link and compare normal input, harmless punctuation, quote failure, evaluated concatenation, extra output, public lookup and private impact. They also check the separate
verifier, rejects another instance's flag, tests malformed/oversized input, and confirms
that the page does not expose verifier/file routes or unescaped HTML.

Optional internal-only Docker smoke test, with no host process restart. The temporary override removes both host publications; `!override` support was verified with Compose5.3.1:

```bash
cd challenges/greeting-expression-lab/local
export FLAG_SEED="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
exercise_override="$(mktemp)"
cat > "$exercise_override" <<'YAML'
services:
  web:
    ports: !override []
  verifier:
    ports: !override []
YAML
docker compose -f docker-compose.yml -f "$exercise_override" config --quiet
docker compose -f docker-compose.yml -f "$exercise_override" up --build -d --wait
docker compose -f docker-compose.yml -f "$exercise_override" exec -T web node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)})"
docker compose -f docker-compose.yml -f "$exercise_override" exec -T verifier node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>{if(!r.ok)process.exit(1)})"
# Internal checks only; host port/Portal integration remains blocked on the validation host.
docker compose -f docker-compose.yml -f "$exercise_override" down
rm "$exercise_override"
unset FLAG_SEED exercise_override
```

Do not use these fixed ports if already occupied. Use a disposable development
machine; do not publish either port to a LAN or Internet. This smoke test is not
claimed as completed merely because unit tests or catalog CI pass.

## Resources, retention and teardown

No AWS/cloud resources or Region; no dollar-based estimate. Two local containers use
up to 128 MiB and 0.5 CPU each, 32 processes each, two internal bridges and two loopback
ports. Image pulls/builds use disk and may require network before startup. Budget 25
minutes for the exercise. There are no persistent volumes. In TenkaCloud, `make down`
stops owned environments while preserving event/score/participant data and saved
runtime secrets for resume; explicit problem teardown removes its containers/networks.
For the standalone smoke test, the shown `docker compose down` removes only that
project. Keep the same seed for that project until teardown; a different seed changes
its answer.

Verification performed for this PR: problem unit/HTTP tests and the existing catalog
gate. A separate two-container internal HTTP rehearsal is recorded in the PR; it does not certify host-port/Portal access, remote-team isolation or a real event. Both internal networks are retained. No relay or ordinary-network fallback is included.
