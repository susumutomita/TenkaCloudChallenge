# MCP Origin Guardian

> TenkaCloud Challenge · difficulty 3 · 45–60 min · local Docker · verify scoring

A browser-driven defensive lab about authority boundaries in an MCP-like OAuth protected
resource. It uses no real OAuth provider, credential, cloud account, or outbound network.

## Runtime

| Binding | Purpose |
| --- | --- |
| 127.0.0.1:18110 | Browser Workbench and synthetic resource API |
| 127.0.0.1:18111 | Loopback verifier used by TenkaCloud |

The container runs read-only as a non-root user with all Linux capabilities dropped. Both
ports bind only to loopback.

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
verifier replays positive and negative requests, so a constant allow/deny answer cannot pass.

## Cleanup and cost

No AWS resources are created and estimated cost is USD 0. Stop it with:

    docker compose -f challenges/mcp-origin-guardian/local/docker-compose.yml down --volumes --remove-orphans

Physical impact: CREATE / UPDATE / REPLACE / DELETE are all none; local container only.
