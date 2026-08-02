# TenkaCloudChallenge Symphony security runbook

Symphony is an engineering-preview orchestrator. A per-Issue workspace is useful separation, but it is
not a credential, network, or host security boundary. This repository therefore treats Issue text,
repository content, generated files, dependencies, and agent output as untrusted.

The production-intended path uses operator-installed launchers, a compiled log redactor, and an
immutable workflow copy. Never start a credentialed Symphony service with `make symphony-run` or a
launcher inside a writable checkout.

## Trust boundaries

| Component | May read | Must not receive | Enforcement |
| --- | --- | --- | --- |
| Symphony host | Dedicated `SYMPHONY_TRACKER_TOKEN` with Issues read-only access | Cloud credentials, general `GITHUB_TOKEN`, agent model credential contents | Clean `env -i` environment in the root-owned host launcher |
| Repository hooks | Nothing; all hooks are disabled | Every host secret | `hooks: {}` and deterministic workflow validation |
| Dependency bootstrap container | Public checkout and lockfile | Tracker, GitHub write, model, and cloud credentials | Separate internal network and package-registry-only proxy; lifecycle scripts disabled |
| Coding-agent container | One read-only model credential and writable Issue workspace | Raw tracker token, GitHub write token, host files, Docker socket, cloud credentials | Root-owned launcher, explicit Docker environment, read-only root, dropped capabilities |
| Agent tools | Workspace files and Codex app-server | Direct network access | Codex `networkAccess: false` plus an internal Docker network |
| Model traffic | Operator allowlisted OpenAI/ChatGPT destinations | Arbitrary Internet destinations | Credential-free CONNECT proxy on the only egress route |

The tracker token and model credential are different credentials. The tracker token must be a
fine-grained, repository-scoped credential with **Metadata: read** and **Issues: read** only. The agent
gets no repository write credential, cannot publish a branch or PR, and ends with a handoff. A human
uses normal protected-branch review and checks to publish and merge the result.

The handoff deliberately enters Symphony's `approval_required` blocked state. The operator does not
approve the no-op request. They first remove `agent:ready`, which makes the Issue non-routable, and
then review `.symphony-handoff.md` and the workspace. Normal turn completion is not a handoff: an open
Issue that keeps `agent:ready` would otherwise be continued and eventually dispatched again.

## Why the launchers live outside the checkout

Symphony launches `codex.command` from the Issue workspace. If that command pointed at a file in the
checkout, an earlier agent turn could replace it and gain the orchestrator's privileges on the next
attempt. The accepted path is fixed:

```text
/usr/local/libexec/tenkacloud-symphony-host
  -> reviewed Symphony binary
  -> /usr/local/libexec/tenkacloud-symphony-agent
  -> pinned container image@sha256:...
  -> /usr/local/libexec/tenkacloud-symphony-redact-logs
/etc/tenkacloud-symphony/WORKFLOW.md
```

The launchers, redactor, Symphony binary, and installed workflow must be root-owned, non-symlink
files that are not writable by group or other users. The host launcher verifies their approved
SHA-256 values before starting. Symphony may hot-reload only the immutable installed workflow, never
the checkout copy.

The files under `.symphony/operator/` and the redactor source are reviewable installation sources
only. Build and copy them to the operator boundary after review:

```bash
bun build --compile scripts/symphony-log-redactor.ts \
  --outfile /tmp/tenkacloud-symphony-redact-logs
sudo install -o root -g root -m 0555 \
  .symphony/operator/tenkacloud-symphony-host \
  /usr/local/libexec/tenkacloud-symphony-host
sudo install -o root -g root -m 0555 \
  .symphony/operator/tenkacloud-symphony-agent \
  /usr/local/libexec/tenkacloud-symphony-agent
sudo install -o root -g root -m 0555 \
  /tmp/tenkacloud-symphony-redact-logs \
  /usr/local/libexec/tenkacloud-symphony-redact-logs
sudo install -d -o root -g root -m 0755 /etc/tenkacloud-symphony
sudo install -o root -g root -m 0444 \
  .symphony/WORKFLOW.md \
  /etc/tenkacloud-symphony/WORKFLOW.md
```

Do not invoke the source copies with a token. Reinstall and approve new hashes after every reviewed
launcher change.

## Container and egress contract

The agent image is supplied by the operator and must include the reviewed Codex app-server, Git, and
Bun 1.3.11. `SYMPHONY_AGENT_IMAGE` must include an immutable digest; tags alone are rejected.

Two Docker-internal networks are required:

- The bootstrap network reaches only an operator-owned proxy that allows `registry.npmjs.org`.
- The agent network reaches only an operator-owned proxy that allows the model-provider destinations
  in `squid-model.conf.example`.

The proxy containers join both their internal client network and a separate outbound network. The
agent and bootstrap containers join only their respective internal network. The launchers verify
Docker reports each client network as `Internal=true`. A proxy URL containing credentials is
rejected.

The agent container runs with:

- a read-only root filesystem;
- all Linux capabilities dropped and `no-new-privileges`;
- explicit CPU, memory, and process limits;
- no Docker socket, SSH directory, cloud credential directory, or host home mount;
- only the Issue workspace mounted writable;
- only a temporary copy of the model credential mounted read-only.

The bootstrap container uses the same restrictions, gets no credential, and runs only:

```bash
bun install --frozen-lockfile --ignore-scripts
bun install --cwd battles/microservice-migration-battle/services \
  --frozen-lockfile --ignore-scripts
```

Both dependency graphs are prepared before the agent network is selected. The 15-minute app-server
read timeout covers a cold, pinned bootstrap. The coding-agent `docker run` keeps stdin attached so
Symphony's JSON-RPC messages reach `codex app-server`. Before starting that container, the immutable
launcher creates an `agent/symphony-*` branch derived from Symphony's workspace name. Codex therefore
never needs approval to write protected Git metadata.

Inside the network-isolated agent, `make symphony-agent-gate` runs every local deterministic check.
It intentionally omits `course:drift`, because that command calls the public GitHub API. After the
blocked handoff, the operator must run the complete `make agent-gate` outside the container so that
course drift is still a publication gate rather than an impossible in-agent step.

## Starting the reviewed runtime

Set the following in an operator-owned service manager or secret store. Do not put values in this
repository, a shell history, an Issue, or a log:

- `SYMPHONY_TRACKER_TOKEN`
- `SYMPHONY_BIN` and `SYMPHONY_BIN_SHA256`
- `SYMPHONY_WORKFLOW=/etc/tenkacloud-symphony/WORKFLOW.md` and
  `SYMPHONY_WORKFLOW_SHA256`
- `SYMPHONY_AGENT_LAUNCHER_SHA256`
- `SYMPHONY_LOG_REDACTOR_SHA256`
- `SYMPHONY_AGENT_IMAGE`
- `SYMPHONY_BOOTSTRAP_NETWORK` and `SYMPHONY_BOOTSTRAP_PROXY`
- `SYMPHONY_AGENT_NETWORK` and `SYMPHONY_AGENT_PROXY`
- `SYMPHONY_MODEL_AUTH_FILE`
- `SYMPHONY_SERVICE_HOME`, `SYMPHONY_WORKSPACE_ROOT`, and `SYMPHONY_LOGS_ROOT`
- `SYMPHONY_RAW_LOGS_ROOT`, an empty directory on Linux `tmpfs` or `ramfs`
- optional `SYMPHONY_PORT` (default `4313`)

Run the service as a dedicated unprivileged OS account. All four runtime directories must already
exist, be owned by that account, have mode `0700`, resolve outside
`/etc/tenkacloud-symphony`, and not be symlinks. `SYMPHONY_RAW_LOGS_ROOT` must be empty at startup.
The host refuses a persistent filesystem for raw logs.

Start only the installed host launcher:

```bash
/usr/local/libexec/tenkacloud-symphony-host
```

The host launcher refuses ambient GitHub and AWS credential variables, clears the rest of the
environment, pins all executable/configuration hashes, and rechecks ownership and permissions at
startup. Raw Symphony disk logs exist only in the private volatile filesystem. The same compiled,
binary-safe redactor builds a volatile redaction set from the tracker token and every string value in
the model auth JSON, filters the live console, and copies the runtime log tree to a private persistent
run directory. It verifies that none of those values remain, deletes the volatile redaction set, and
only then deletes the raw log files. A redaction failure stops the runtime and leaves the raw copy
only on private volatile storage.

The agent cannot run a nested `codex exec review`: child tools intentionally lack model network
access. After the blocked handoff, the human operator runs that independent review outside the agent
container before publishing anything.

## Validation and evidence

`make symphony-validate` is deterministic and credential-free. It:

- parses YAML rather than searching for reassuring strings;
- rejects the generic `GITHUB_TOKEN`, hooks, repository-local launchers, automatic approval, direct
  tool network access, full-access sandbox types, short bootstrap timeouts, retrying handoffs,
  missing external isolation, direct egress, and agent write credentials;
- validates Bash syntax and the required Docker restrictions;
- runs a synthetic canary test proving the agent launcher fails before Docker if the tracker secret,
  either GitHub token name, or any AWS credential variable reaches it;
- drives the launcher rather than reading it, proving that a Docker network which is not internal or
  does not exist, a proxy URL carrying a credential or a non-`http://host:port` scheme, and a
  symlinked model credential each stop the run before a container starts;
- proves the agent app-server has stdin, both dependency graphs are prepared, and only the two
  explicit restricted container plans are produced by fake Git and Docker processes;
- proves the immutable launcher creates the workspace branch before the approval-blocked app-server
  starts, while the agent prompt forbids later branch mutation;
- runs the same binary-safe redactor used by the host against a split live stream and a binary
  runtime log tree, then proves neither tracker nor model-auth canaries reach persisted output.

Those checks do not claim that an operator machine, proxy, image, or live Symphony binary was tested.
Before first production-intended use, attach separate isolated-harness evidence for all of the
following:

1. A synthetic tracker canary is available to Symphony but absent from hooks (disabled), the agent
   launcher, both containers, and persisted logs.
2. A non-allowlisted outbound destination fails from the agent container.
3. Required model calls succeed only through the model proxy; the bootstrap proxy is unreachable.
4. The tracker credential cannot write repository contents, comments, labels, or Issue state.
5. A synthetic Issue reaches `approval_required` exactly once, does not retry, and becomes
   non-routable after the operator removes `agent:ready`.
6. The external operator review runs after handoff; no nested review or automatic merge occurs.
7. Container teardown leaves no agent process, credential copy, writable root layer, or raw log on
   persistent storage.

Until that evidence exists, report external/runtime validation as **SKIPPED**, not passed. A failure
in any item keeps the service out of production-intended unattended use.
