# Before You Press Enter (`agent-approval-gameday`)

**Battle · difficulty 3 · 45-60 min · runs entirely in Docker · USD 0**

Suspicious activity is detected on an AI-built order API. Capability is released to the
agent in three stages, and you decide what to approve.

The question this problem asks is not whether you may use an AI. It is **which
capability you hand it, when, and what you check before approving an execution**.

## The story

The environment has resources whose names and tags look alike: a compromised worker, the
healthy production API, a validation canary, the audit evidence store, and a shared
config object every one of them depends on.

The request that arrives reads:

> Stop every suspicious resource, delete what is not needed, and get us to a safe state.

It sounds reasonable. Resolved through the stale `suspicious=true` tag left over from an
earlier, unrelated investigation, it also takes the audit evidence and — through the
dependency graph — the production API.

The correct response is to isolate only what is compromised, while the evidence survives
and production keeps answering.

## The three phases

| Phase | Tools the gateway exposes | What you are doing |
| --- | --- | --- |
| 1 (0-15 min) | none | Read the evidence yourself. Submit a structured hypothesis. |
| 2 (15-30 min) | `list_resources`, `describe_resource`, `read_logs`, `show_dependencies`, `read_local_runbook`, `evaluate_plan` | Investigate with the agent. Change nothing. |
| 3 (30 min-) | the above plus `propose_change`, `preview_change`, `execute_change`, `rollback_change`, `verify_post_conditions`, `revoke_operator_capability` | Write, but only through propose → preview → approve → execute. |

Phases open on the **server's** clock. A client cannot declare that it is in phase 3, and
a token minted in phase 2 stays a phase-2 token afterwards — otherwise "read-only" would
mean "read-only until the clock moves".

Phase 1 does not try to detect whether you used an AI outside the platform. That is
unenforceable and not the lesson. What is enforced is access to *this problem's* tools;
banning outside AI at an event is the organizer's rule, not the container's.

## How a write happens

1. `propose_change` creates an **immutable** proposal: target selector, action, evidence,
   expected post-conditions, rollback.
2. `preview_change` resolves the selector **against the world as it is now** and returns
   what would change, what else it would touch, and what depends on those — plus an
   `approvalDigest` computed over that resolved content.
3. `execute_change` requires that digest back. If the world moved since the preview, the
   digest no longer describes what would happen, and the execution is refused and
   recorded rather than silently re-resolved.
4. Re-observe. `verify_post_conditions` reads external state; it does not ask the agent
   whether it worked.
5. `rollback_change` undoes a reversible action. **`delete` has no rollback.**

## Scoring — 1000 points

| Checkpoint | Points | Cleared when |
| --- | ---: | --- |
| `manual-hypothesis` | 100 | The named resource, the cited evidence and the protected list are all right |
| `evidence-backed-plan` | 150 | An exact-selector plan with evidence, post-conditions and rollback |
| `safe-proposal-review` | 150 | The dangerous proposal was previewed **and** not executed |
| `threat-containment` | 200 | The compromised resource can no longer run |
| `service-availability` | 200 | The production API still answers |
| `evidence-protected` | 150 | The evidence store and the healthy resources survive |
| `capability-closure` | 50 | The operator capability is revoked, with the threat contained |

Penalties: executing a proposal that includes a protected resource `-250`; losing the
audit evidence `-300` (which stays even if you repair the final state); executing without
a preview `-100` each; `-5` per tick of production downtime.

Containment and availability are both required. Stopping everything contains the threat
and fails availability; doing nothing keeps availability and fails containment.

**Nothing here grades the agent's prose.** Every gate reads resource state or the
operation record, so swapping the model does not move the score and a confident wrong
summary earns nothing.

## Playing it

Open the access URL the portal shows. Everything — the incident timeline, the resource
and evidence viewer, the structured plan editor, and the proposal diff and approval
screen — is reachable from the browser.

An MCP-capable client (Kiro, Claude Code, or any other) can call the same tools through
`POST /gateway/call` with a token from `POST /gateway/token`. It is a way to play, never
a requirement: **every checkpoint is reachable from the browser alone.** Owning a
particular product is not a condition of this problem.

```
GET  /gateway/tools           what is callable in the phase that is open now
POST /gateway/token           mint a capability token for that phase
POST /gateway/call            { tool, token, sessionId, input }
GET  /posture                 gates, receipts, penalties, score
GET  /audit                   tool calls, denials, approvals, executions (read-only)
```

## Cost and safety

Zero. One container, loopback only, no external network (`connect` is denied by seccomp),
non-root, read-only root filesystem, all capabilities dropped. The problem asks for no
model API key, no AWS credential and no GitHub token.

## Related

- `battles/stackstack-gameday` — the phased local-Docker Battle this follows
- `battles/hello-world-battle` — the minimal Battle scoring reference
