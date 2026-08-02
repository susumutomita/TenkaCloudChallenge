# MCP Origin Guardian

> TenkaCloud Challenge · difficulty 3 · 45–60 min · local Docker · verify scoring

A browser-driven defensive lab about authority boundaries in an MCP-like OAuth protected
resource. It uses no real OAuth provider, credential, cloud account, or outbound network.

## Runtime

| Binding | Service | Purpose |
| --- | --- | --- |
| 127.0.0.1:18110 | participant | Browser Workbench and synthetic resource API |
| 127.0.0.1:18111 | verifier | Public tests, submission preparation, and loopback `/verify` |

Both services run read-only as non-root users with every Linux capability dropped. Their
published ports bind only to host loopback. Participant and verifier use separate Docker
networks, and a custom seccomp profile denies the `connect(2)` syscall in both containers.
The services can accept the intended loopback requests but cannot initiate outbound TCP
connections.

The participant image contains only the Workbench, observation/resource API, and policy
execution primitives. Published test decisions, submission preparation, the hidden grader,
and `/verify` exist only in the separate verifier image. The browser calls those verifier
endpoints through an exact-origin CORS policy. This is a physical Docker build-target and
image boundary, not code obfuscation.

## Mission

The service derives its allowed Host and protected-resource metadata from the same incoming
request. The values agree, but an attacker controls their common source. Use Browser
Workbench to:

1. compare a normal and attacker-controlled authority;
2. configure an operator-approved production HTTPS origin;
3. reject unknown Host, Origin, and forwarded authority;
4. keep the loopback exception behind explicit development mode;
5. run public cases and prepare the submission for Participant Portal.

The submitted value is a base64url policy document. It contains no credential or flag. The
verifier independently replays unpublished positive and negative cases, so a constant
allow/deny answer or a branch written only for the published cases cannot pass.

## Cleanup and cost

No AWS resources are created and estimated cost is USD 0. Stop it with:

    docker compose -f challenges/mcp-origin-guardian/local/docker-compose.yml down --volumes --remove-orphans

Physical impact on cloud resources: CREATE / UPDATE / REPLACE / DELETE are all none. Only
disposable local containers, images, and Docker networks are created and removed.
