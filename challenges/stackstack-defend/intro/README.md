# Stop the leak: short Defend introduction (local preview, #958)

A Japanese, beginner-facing companion mode to `stackstack-defend`: start → read your fictional profile and another member's profile → change the server's ownership policy → verify legitimate reads and forbidden reads over real HTTP → learn authentication versus authorization. **Three minutes is a target; no first-time human timing has been conducted.** No deployment, public hosting, cloud subscription or LP change is included.

From the repository root, with Node.js 22+ (standard modules only):

```sh
node challenges/stackstack-defend/intro/server.mjs
# Open http://127.0.0.1:18090; Ctrl-C stops admission and destroys workers.
node --test challenges/stackstack-defend/intro/*.test.mjs
make install
make agent-gate
```

The existing five-checkpoint Docker/Portal challenge, metadata and 60-second hold are unchanged. This companion has no new catalog entry or Portal adapter. It extracts and reuses Defend's strict data-only, default-deny, explicit-deny-precedence policy evaluator. No arbitrary code, filesystem paths or outbound destinations are accepted.

Each session gets a disposable OS process and an internal loopback HTTP target. Browser API calls trigger real profile HTTP requests; the UI distinguishes browser requests from internal GETs. Server-side policy changes affect subsequent requests. Verification checks exact own-profile bodies and HTTP 403 for cross-owner reads, in both directions, against existing and fresh random IDs (8 probes). Initial own/leak observation is also required. All-allow, all-deny, disabled service, throttling and observed-ID-only policies fail. This is immediate regression evidence, not sustained load testing or an AWS/VM exercise.

Safety controls implemented: 4 sessions by default (hard configuration ceiling 8), reserved before asynchronous startup and released only after process exit; 5-minute TTL (ceiling 10 minutes), no extension, fresh credentials/data on restart; 256-bit HttpOnly SameSite Strict Cookie credentials (Secure for HTTPS origin), never in URLs/logs/response bodies; independent internal HTTP credentials; IPC-only control/verifier, exact route/method allowlist, exact Origin/custom header on mutations, Host validation, no CORS, CSP/no-store/no-referrer. Only session-local state, score and policy can be accessed. Same-browser tabs share a session. Reload resumes it; end/retry destroys it.

Limits: 1 KiB JSON, 8 KiB headers, 5-second request/header/socket timeout, 4-second IPC timeout, 1.2-second probe timeout, one operation per session, 32 active handlers, 48 connections, 100 requests per socket, global fixed-window 300 requests and 20 starts per minute. Full/rate-limited states return actionable 503/429 feedback. Workers inherit only TZ, no parent credentials, no stdio, and have a 64 MiB Node heap ceiling. No Docker socket, host secrets or cloud credentials are passed. This is process separation for a fixed data-only interpreter, not an arbitrary-code sandbox or an RSS/CPU enforcement mechanism.

Configuration: `PORT` (18090), `PUBLIC_ORIGIN` (exact external origin), `MAX_SESSIONS` (1–8), `SESSION_TTL_MS` (1–600000). Listener always binds loopback. Use a same-environment TLS reverse proxy for future hosting. Subpath hosting is unsupported; run exactly one gateway or capacity multiplies.

**Before any public release**, provision a dedicated non-root, secret-free execution environment with read-only filesystems, capability/PID/CPU/RSS/FD limits, no host mounts/socket/instance credentials, network egress denied except necessary loopback, TLS, strict proxy route forwarding/Host preservation, proxy rate/body/concurrency/transfer controls, monitoring and an operator kill switch. Retest HTTPS Cookies, CSRF, disconnects and shutdown through that proxy. These infrastructure controls have NOT been applied or verified here. Do not expose the existing Simulator, worker ports or private management surfaces.

Provider/Region/contracts remain undecided. VM/compute/memory/disk/proxy/TLS/logs/egress and abuse responses can incur charges. Fixed workers/VMs and billing alerts are not absolute billing caps; no free or absolute-cap promise is made. Decide cost limits and shutdown ownership before publication. There is no external analytics; any future funnel measurement must exclude credentials, answers and record bodies.

Validation: automated tests cover the HTTP flow, both legitimate and forbidden directions, fresh IDs, false repairs, cross-session state/score/control boundaries, TTL/reuse, capacity/parallel admission, CSRF/bad input/body/rate, private routes, and the long Defend drill/hold/legitimate publish/reset. Included in `make agent-gate`; JavaScript syntax checked with `node --check` (no separate lint/typecheck configuration). Browser checks on the connected Mac covered PC and 390×844 viewport flow, false repair, reload, retry and stop; mobile document/scroll widths both 390px. Real devices, other browsers, cloud and long-duration load remain untested.

Human unaided timing and learning evaluation, funnel instrumentation, LP integration, production isolation and a recorded demo remain outstanding; this is a Draft PR and does not close all of #958. Replay for a demo: show the real-HTTP/target-time notice, own 200, other 200 with changed ID, ownership rule, verify 200/403 in both directions and fresh IDs, then the learning sentence. Never record Cookie/Authorization headers. No video/screenshot deliverable is included.

See [the detailed Japanese runbook](README.ja.md) for safety boundaries, operational prerequisites and replay instructions.

Validation runtime: Node 22.23.5 and Node 26.13.0 on the connected Mac. The authenticated end operation remains available when the global rate budget is exhausted.

After completion, an optional collapsed “実務ではどう実装する？” supplement connects the selected ownership rule to the actual HTTP handler/shared evaluator, exact positive/negative test snippets, and concise workplace requirements/design/test prompts. Source correspondence is tested. It does not claim to implement organization/role rules.
