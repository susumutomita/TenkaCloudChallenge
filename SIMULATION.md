# Simulation overlay contract

> 日本語版: [SIMULATION.ja.md](./SIMULATION.ja.md)

TenkaCloud Simulator derives local-play requirements from provider-native IaC,
IAM policies, endpoint/scoring metadata, and disruption metadata. A problem adds a
`simulation.json` overlay only when those sources cannot identify a workload or
data-plane behavior. The overlay is a compatibility contract, not a second problem
definition.

The contract is versioned independently from `SCHEMA.json`. `metadata.json` opts in
with an explicit reference:

```json
{
  "simulationOverlay": {
    "schemaVersion": "1",
    "entry": "simulation.json"
  }
}
```

The referenced file must validate against [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json):

```json
{
  "$schema": "../../SIMULATION_SCHEMA.json",
  "schemaVersion": "1",
  "requirements": [
    {
      "targetId": "default",
      "service": "http",
      "resourceType": "HTTP::Endpoint",
      "operation": "Request",
      "fidelity": "L4",
      "plane": "participant"
    }
  ]
}
```

`targetId` is always the normalized runtime target. A single runtime uses
`default`; a composite runtime uses the matching `runtime.targets[].id`. The
Simulator scanner inherits provider and engine from that target and records every
overlay requirement with `origin: "simulation-overlay"` and the source JSON
pointer.

## Allowed content

- `requirements[]` may add only provider/resource/operation/fidelity/plane facts
  that cannot be derived from the normal catalog sources.
- `workloads[]` may describe an executable OCI workload only when `image` is a
  registry reference pinned by `@sha256:<64 lowercase hex>`. It may bind a
  `resourceRef`, unprivileged `containerPort`, optional `healthPath`, command, and
  a content-addressed repository artifact.
- An artifact is `{ "path": "...", "sha256": "..." }`. The path stays inside the
  problem directory, contains no symbolic-link component, and the digest is over
  the exact regular-file bytes. An artifact is compatibility evidence; by itself
  it is not an executable workload.
- A catalog-owned workload image is built from the same reviewed service modules
  used by the cloud problem. Its workflow publishes a multi-platform manifest to
  GHCR, reports the immutable manifest digest, and never updates `simulation.json`
  to a mutable tag. The overlay `resourceRef` binds that image to a real stack
  output; a simulator-only replacement handler is not acceptable.

The overlay deliberately has no scoring, answer, flag, secret, credential,
environment-variable, network-egress, or host-mount fields. Unknown fields fail
validation. This keeps scoring and answers in their existing problem/runtime
boundary and prevents an overlay from becoming a privileged execution escape.

## Binding evidence versus authorization inventory

An IAM `Allow` states what a principal is permitted to do. It does not prove that
the participant, workload, scorer, or operator actually invokes every allowed
operation. Console discovery lists, cleanup alternatives, and broad managed-runtime
workflows routinely authorize more operations than one valid play path executes.

Compatibility therefore treats IAM actions as non-blocking authorization inventory.
An operation becomes a binding requirement only when it is evidenced by an IaC
resource relationship, structured scoring/disruption metadata, or an exact overlay
entry. If a documented participant or workload command is the only execution
evidence, add just that operation to `requirements[]`. Do not paste the surrounding
IAM allow-list into the overlay, and do not use an overlay to suppress an authorized
operation. This separation keeps missing-capability failures loud without claiming
that permission breadth equals runtime use.

## Validation and compatibility

`bun run validate` rejects:

- an entry that is missing, unreadable, outside the problem, or a symbolic link;
- an overlay whose schema version differs from its metadata reference;
- unknown or duplicate target/requirement/workload identifiers;
- an unpinned image, privileged port, invalid health path, or unsafe command;
- an artifact that is missing, not a regular file, crosses a symlink, or has a
  stale SHA-256;
- an overlay larger than 1 MiB or an artifact larger than 16 MiB;
- a `simulation.json` file that is not referenced from its problem metadata.

The compatibility workflow checks out a pinned TenkaCloudSimulator revision,
generates the Simulator capability manifest, and scans this checkout. Missing,
insufficient, or invalid requirements fail loudly before a simulation world is
created. The report is deterministic and does not contain credentials or answers.
`bun run validate` also installs the catalog-owned workload workspace from its
frozen lockfile with lifecycle scripts disabled before running its test and strict
typecheck, so a fresh clone cannot rely on residual nested dependencies.

## Current cloud-catalog audit

Audit baseline: TenkaCloudChallenge commit
`68516c8694283baf72267568ec2dad865700d3e5` (20 problems, 9 cloud-backed
problems, 10 cloud targets). The decision below uses the scanner source kinds and
L4 requirements, not problem prose alone.

| Problem | Existing machine evidence | Overlay decision |
| --- | --- | --- |
| `cloudflare-api-security` | IaC identifies the AWS evaluator; instructions and generated `evaluate.sh` prove SSM/S3 reads plus participant `Lambda InvokeFunction`, while the participant-owned `*.workers.dev` probe is otherwise absent. | Required: declare those exact participant commands and the external HTTP scoring probe. |
| `hello-multicloud` | AWS/GCP IaC plus per-target `composite-probe` metadata identify both resources and L4 probes. | Not required. |
| `hello-world` | The solve instructions explicitly invoke `SSM GetParameter`; IAM permission alone is not binding execution evidence. | Required: declare the exact participant read. |
| `hello-world-battle` | IaC + endpoint/probe metadata + `ssm-run-command` identify scoring/fault paths; the player instructions separately require `SSM StartSession`. | Required for the exact participant `ssm/AWS::SSM::Session/StartSession` operation; do not promote the rest of the session IAM allow-list. |
| `http-query` | Instructions explicitly use Logs `FilterLogEvents` and ELB `DescribeRules` / `ModifyRule`; neither IaC nor metadata identifies the participant's non-standard HTTP `QUERY` request path. | Required: declare the exact control-plane commands and participant HTTP request behavior. |
| `microservice-migration-battle` | IAM is only the broad migration authorization envelope. The guide explicitly invokes `Lambda CreateFunction`; metadata declares polling, while the three participant-migrated services require materialized runtime behavior. | Required. The catalog gateway image imports the same users/orders/catalog Hono applications, binds the stack `BaseUrl`, and is pinned by the published multi-platform manifest digest. |
| `security-battle-royale` | IaC + endpoints + scoring probes + attack probes + SSM disruption identify the data plane and faults. | Not required. |
| `stackstack` | IaC + endpoints + poll/attack-probe metadata + disruption metadata identify scoring and faults; player instructions separately use SSM, S3, WAF, and EC2 operations. | Required for those exact participant operations. |
| `x402-paywall` | IaC contains the Lambda handler and SSM configuration; the bundled bot-client flow explicitly uses S3/SSM/STS and invokes the gate Lambda. IAM authorization alone is not invocation evidence. | Required: declare those exact participant operations. |

When a problem changes, rerun compatibility instead of copying an overlay to it.
An overlay is justified only by a concrete gap in the scanner's ordinary sources.
