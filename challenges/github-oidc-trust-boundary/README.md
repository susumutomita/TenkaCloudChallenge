# Which Workflow Is This Token From?

> TenkaCloud Challenge · difficulty 3 · 45–60 min · local Docker · multi-verify (6 checkpoints, 200 points)

The production role no longer stores a long-lived AWS secret, but its starter trust policy
accepts every repository, branch, pull request, and environment under one GitHub owner and
does not check the AWS audience. Repair the boundary without contacting GitHub or AWS.

## What you will do

1. Run the starter claim matrix and record four unintended allows.
2. Keep the exact GitHub OIDC provider and `sts:AssumeRoleWithWebIdentity` action.
3. Match `token.actions.githubusercontent.com:aud` to the single string `sts.amazonaws.com`.
4. Match `token.actions.githubusercontent.com:sub` exactly to
   `repo:tenkacloud/production-app:environment:Production`.
5. Reject other repositories, branch and pull-request subjects, wrong or missing claims,
   multi-valued audiences, and an untrusted caller that uses an approved reusable workflow.
6. Re-evaluate a shuffled matrix without changing any result.

GitHub documents the issuer as `https://token.actions.githubusercontent.com`. For AWS, the
official audience is `sts.amazonaws.com`, and IAM recommends evaluating the GitHub `sub`
condition to limit which workflows can assume a role. Environment jobs use
`repo:ORG/REPO:environment:ENVIRONMENT`; branch and pull-request jobs use different subject
formats. Read the primary documentation from
[GitHub's AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc),
[AWS's GitHub OIDC role guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html),
and [AWS's OIDC provider guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html).

## Model boundary

This is a deterministic teaching model, not an AWS IAM, STS, or JWT-signature emulator. It
models one Allow statement, the federated provider, the web-identity action, and the
`StringEquals` / `StringLike` conditions for `aud` and `sub`. Extra JWT claims are ignored as
real GitHub tokens carry many of them; missing or non-string claims needed by a condition fail
closed. The lab deliberately requires a single-string audience.

AWS does not support GitHub custom claims in role trust policies. `job_workflow_ref` is shown
as evidence of reusable-workflow identity, while the default `sub` remains the caller's
repository context. An untrusted repository does not become trusted merely by calling an
approved reusable workflow. GitHub recommends environment protection rules as the additional
control for which branches and tags may deploy to that environment.

## Architecture and cleanup

```text
Browser Workbench (participant image, 127.0.0.1:18122)
  -> starter policy, observation matrix, editor
  -> public cases and submission preparation over loopback

Verifier image (127.0.0.1:18123)
  -> reference policy, hidden matrix, mutations, six checkpoint graders
```

The images are separate, non-root, read-only, capability-free, and use a seccomp profile that
denies outbound network syscalls. The participant image contains no reference policy, hidden
matrix, mutation suite, or grader.

    docker compose -f challenges/github-oidc-trust-boundary/local/docker-compose.yml up --build

Open `http://127.0.0.1:18122/`. When finished:

    docker compose -f challenges/github-oidc-trust-boundary/local/docker-compose.yml down --volumes --remove-orphans

Estimated cost is USD 0. No cloud resource is created, updated, replaced, or deleted.

## Assurance scope

Local play is honor-system verification: the participant controls the host, Docker daemon,
images, and filesystem. The committed reference and hidden verifier are separated from the
participant image to preserve the normal learning path, not to make them unreachable to the
host owner. Local results must not be used as evidence for a competition, examination, or
certification. Trusted remote verification is tracked in issue #271.

Automated CI and agent-operated local flows are source/runtime evidence. A human learner
playtest is not claimed unless a person completes and records the full flow.
