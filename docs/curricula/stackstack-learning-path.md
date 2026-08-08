# Absolute beginner to StackStack — learning-path contract

`absolute-beginner-to-stackstack` is TenkaCloud's default local-play learning path for a
person who has operated neither a web application nor AWS before. Its destination is the
[`stackstack`](../../battles/stackstack) Battle. The path is machine-readable through each
problem's `track.{id,order,chapter}` fields; this document records why that order exists
and where the current catalog still does **not** supply a prerequisite.

The Advanced Cryptography Program 2026 companion is a separate, independent course. It
remains available in the course-track screen, but it is not a prerequisite, branch, or
continuation of this StackStack route.

## Why the route begins with `sqli-demo`

The local-play platform pins `sqli-demo` as the zero-progress introductory drill. The
track therefore makes that real first screen honest: `sqli-demo` is order 10, and after it
is solved this track's own recommendation is `stackstack-onboarding` at order 20 instead
of an unrelated course.

The platform's recommendation policy is a separate cross-repository contract. Older
versions selected the lexicographically first track; current TenkaCloud `main` uses an
explicit priority list. The catalog now supplies the missing route, but the platform must
name `absolute-beginner-to-stackstack` in that priority list before the second home-screen
recommendation follows it. This is not hidden as a completed prerequisite: a live
cross-repository check on 2026-08-09 showed the zero-progress screen correctly pinned to
`sqli-demo`, while the screen after solving it selected the currently prioritised
`automotive-security` track. That platform follow-up does not belong in this catalog PR.

## Ordered route and prerequisite audit

The order below comes from the player instructions and README flows, not from the numeric
`difficulty` field.

| Order | Problem | Why it is here / knowledge available from earlier steps |
| ---: | --- | --- |
| 10 | `sqli-demo` | The platform's actual first problem. A single browser form gives the first capture-and-submit loop. |
| 20 | `stackstack-onboarding` | A no-trap lap through portal → endpoint → `/docs` → log → config → measured posture on the same board used by later StackStack drills. |
| 30 | `wp-exposed-backup` | Defines a URL "path" at first use and walks an external visitor through `robots.txt`, public files, logs, and directory listing with free graduated hints. |
| 40 | `wix-exposure-audit` | Reuses public-path inspection, then adds sitemap/source/metadata discovery and verifies remediation of publication, share-link, and collaborator boundaries. |
| 50 | `xss-demo` | Moves from "what is public" to what unescaped text can do in another viewer's browser. Its IPA §1.5 provenance remains in the README/tags. |
| 60 | `csrf-demo` | Explicitly contrasts its forged action with the preceding stored-XSS problem, then introduces intent checks and browser-session defenses. Its IPA §1.6 provenance remains in the README/tags. |
| 70 | `hello-world-battle` | The AWS/Battle bridge: copy a CloudFormation Output, register real endpoints in the portal, enter an SSM shell, and recover nginx with `systemctl`. These are direct StackStack prerequisites. |
| 80 | `wp-harden-leaks` | Reuses the exact four surfaces discovered in `wp-exposed-backup`; now the participant operates a shell, fixes causes, and proves the live external behavior changed. |
| 90 | `wp-midnight-admin` | Builds from public WordPress evidence into incident reconstruction, cleanup, credential rotation, and reverification before the StackStack incident drills. |
| 100 | `stackstack-ship` | The StackStack README names onboarding as its prerequisite. It separates build from deploy and teaches measured public release, runtime config, and secret references. |
| 110 | `stackstack-vibe-build` | Its story assumes the board was exposed "yesterday", so it follows `ship`; the earlier XSS step also gives context for its output-escaping requirement. |
| 120 | `stackstack-defend` | Adds principal/resource authorization while keeping valid traffic alive. Its README names both onboarding and `ship` as prerequisites. |
| 130 | `stackstack-safe-exposure` | Extends the preceding authorization decision to owner, tenant, role, visibility, list/object parity, and monitoring continuity. |
| 140 | `stackstack-observability` | Uses the already-shipped board and makes metrics, logs, and health agree before the later credential and recovery incidents. Its README explicitly requires `ship`. |
| 150 | `stackstack-secrets` | Onboarding supplied logs; observability supplied evidence handling. This step adds issue → cut over → revoke and least privilege without stopping the digest. |
| 160 | `stackstack-recover` | Combines observation and policy changes: restore public and scheduled paths without rolling back protection, then prove the state survives restart. |
| 170 | `stackstack` | Capstone Battle using the portal/endpoint/SSM/service loop and the release, authorization, observability, credential, and recovery habits rehearsed above. |
| 180 | `wp2shell-local-lab` | An optional advanced post-capstone incident: chain routing normalization and query construction, clean persistence, rotate keys, replay the attack, and preserve normal behavior. |

## Gaps — new problems are still required

The metadata order is a recommendation, not a claim that every prerequisite is already
taught. Reading the current problem statements exposes these discontinuities:

1. **Before `sqli-demo`: basic request and database vocabulary.** The pinned first problem
   eventually names SQL, quoting, comments, and parameterized queries in paid hints and
   the post-solve writeup, but there is no earlier, penalty-free explanation for a reader
   who has never seen a database query. A short browser-only primer is still required.
2. **Before `xss-demo` / `csrf-demo`: browser and HTTP mechanics.** The current statements
   use HTML, script execution, cookies, sessions, Origin, CSP, and request intent without
   defining all of them at first use. A no-exploit browser/request primer is still
   required; moving these problems into the route does not erase that gap.
3. **Before `wp-harden-leaks`: shell and server-file editing.** `hello-world-battle`
   introduces an SSM shell and `systemctl`, but not Docker Compose, Apache configuration,
   PHP config files, or safe file editing. The problem has exact hints, yet a small local
   shell/remediation bridge is still required for a genuinely independent beginner.
4. **Before the `stackstack` capstone: AWS production operations.** The existing drills
   model the decisions, and `hello-world-battle` teaches Output transport, endpoint
   registration, SSM, and service recovery. No current route problem independently
   teaches S3 restore, WAF-to-ALB association, S3 audit writes, SQLite-to-PostgreSQL
   migration, or security-group rule removal. One or more simulator-backed AWS bridge
   problems are required before the route can claim uninterrupted prerequisite coverage.
5. **Platform recommendation after the pinned drill.** TenkaCloud `main` currently names
   `ipa-web-security` and `automotive-security` in an explicit recommendation priority
   list. It must add this track id for the home screen to continue from `sqli-demo` to
   `stackstack-onboarding`; catalog metadata cannot change that platform-owned list.

Until those problems exist, the route should display these as known curriculum gaps. Do
not treat a hint that prints an exact command as evidence that the prerequisite was
taught.
