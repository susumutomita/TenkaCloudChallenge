# Signed Does Not Mean Safe

> TenkaCloud Challenge · difficulty 3 · 45–60 min · local Docker · multi-verify (6 checkpoints, 200 points)

On 2026-08-04, npm namespaces around Keyv and cacheable were compromised, and tampered
releases shipped through the legitimate publish pipeline — with valid provenance
attestations and malicious `preinstall` lifecycle scripts. This lab rebuilds that failure
mode from synthetic fixtures: a provenance attestation verifies WHERE, BY WHOM, and FROM
WHICH SOURCE a package was built and published. It never verifies that the source itself
is harmless. Repair a CI triage policy without touching any real package or network.

## What you will do

1. Observe the fixtures: the app manifest, the lockfile, a valid npm-style provenance
   attestation, the shipped tarball's file inventory, and per-host install evidence.
2. Detect the diff between expected files and the shipped tarball, including an added
   `preinstall` lifecycle script.
3. Judge that the valid attestation binds the source repository and build workflow, but
   does not make the source benign — and that an invalid attestation still fails closed.
4. Track the resolved dependency from the lockfile's exact version, integrity, and
   dependency path, never from the manifest's semver range.
5. Default-deny install lifecycle scripts and allow only the one package that needs its
   script, pinned to its exact resolved version. A global allow is refused.
6. Distinguish not-installed, installed-with-scripts-disabled, and scripts-executed from
   the evidence, and choose isolation, hunting, and credential rotation without over- or
   under-reach. Rotation without execution evidence is refused.

The hidden matrix re-evaluates your policy with a shuffled dependency graph, irrelevant
extra scripts, and a clean valid package. A name-denylist ("keyword") policy fails there.

Read the primary documentation from
[npm's provenance limitations](https://docs.npmjs.com/generating-provenance-statements/#provenance-limitations),
[npm's lifecycle scripts reference](https://docs.npmjs.com/cli/v11/using-npm/scripts/), and
[npm-approve-scripts](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/).
Incident research:
[Snyk on the Keyv compromise](https://snyk.io/blog/inside-keyv-npm-compromise-preinstall-malware-trusted-provenance-ide-hooks/) and
[Socket on the compromised namespaces](https://socket.dev/blog/popular-npm-packages-in-the-keyv-and-cacheable-namespaces-compromised-in-active-supply-chain).

## Model boundary

This is a deterministic teaching model, not an npm client, a registry, or a Sigstore
verifier. Every fixture is synthetic: package names, versions, digests, and the
attestation are declarative data, and no lifecycle script is ever executed. There is no
real malicious package, no credential, no executable malware, and no network access. The
lab is defense-only: it teaches detection, policy, and response scoping, and contains no
implementation guidance for credential harvesting, propagation, or persistence.

## Architecture and cleanup

```text
Browser Workbench (participant image, 127.0.0.1:18124)
  -> fixtures, starter blind spots, triage policy editor
  -> public cases and submission preparation over loopback

Verifier image (127.0.0.1:18125)
  -> reference triage, hidden matrices, mutations, six checkpoint graders
```

The images are separate, non-root, read-only, capability-free, and use a seccomp profile
that denies outbound network syscalls. The participant image contains no reference
triage, hidden matrix, mutation suite, or grader.

    docker compose -f challenges/signed-does-not-mean-safe/local/docker-compose.yml up --build

Open `http://127.0.0.1:18124/`. When finished:

    docker compose -f challenges/signed-does-not-mean-safe/local/docker-compose.yml down --volumes --remove-orphans

Estimated cost is USD 0. No cloud resource is created, updated, replaced, or deleted.

## Assurance scope

Local play is honor-system verification: the participant controls the host, Docker
daemon, images, and filesystem. The committed reference and hidden verifier are separated
from the participant image to preserve the normal learning path, not to make them
unreachable to the host owner. Local results must not be used as evidence for a
competition, examination, or certification. Trusted remote verification is tracked in
issue #271.

Automated CI and agent-operated local flows are source/runtime evidence. A human learner
playtest is not claimed unless a person completes and records the full flow.
