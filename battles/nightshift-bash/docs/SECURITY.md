# Security boundary

## Organizer versus participant

Organizer authority consists of the Docker daemon, host CLI, `.state`, scoring scripts, and reference solutions. Participants receive only a non-root shell in the target container. Both auditor (UID 1100/GID 1100) and operator (UID 1200/GID 1400) are unprivileged OS users. Batch work runs as UID 1300/GID 1400. Operator and batch share a service group, but operator is not root and cannot directly read the batch-only proof token.

The root supervisor exists solely for initial fixture installation, role changes, serialization, and time-limited invocation of application code. It uses immutable absolute paths. User-editable startup scripts run as operator; editable batch code runs as batch. Editable files are never sourced by the supervisor as root. Privilege drops clear supplemental groups and sanitize the environment, including BASH_ENV.

Organizer grading logic is kept in `host/`, excluded from the image, and streamed through stdin to a trusted root shell only for grading. Expected secrets are shell-local variables, not environment variables or command-line arguments. The participant cannot simply edit a local score file to alter host scoring.

This separation does not prevent cheating by someone who controls the organizer host, can read the full source/reference solution out of band, or receives Docker access. There is no remote authentication or terminal-delivery service in this release. Grade-time process attacks, intentional PID exhaustion, sophisticated side channels, and hostile concurrent mutation are not certified. The training rules explicitly exclude grader/host attacks.

## Docker isolation configured by the launcher

The container has network `none`, no published ports, no host bind mounts or socket, read-only rootfs, no-new-privileges, and only CHOWN/DAC_OVERRIDE/FOWNER/SETUID/SETGID/KILL capabilities for the supervisor. Participant shells are non-root and do not acquire those capabilities. Writable tmpfs areas are limited to the application, home, run, and temporary directories. CPU, memory, PID, file-size, and file-descriptor limits are configured.

Docker image construction requires internet access. This restriction applies to the running exercise, not the trusted build process. The Debian base image and apt packages are version-tagged rather than digest/lockfile pinned in this first release; rebuilds are not bit-for-bit reproducible.

Docker image construction and all 33 integration assertions passed on macOS/Colima on 2026-09-27. The application tmpfs uses `exec` so editable exercise scripts can run; `/run` and `/tmp` retain `noexec`. Validate the runtime on each organizer host with `./gameday.sh test`. Health status only means initialization completed, not that the participant's business application is correct.

Containers share the host kernel. Do not treat this package as an absolute sandbox for hostile users. For an external event, prefer a dedicated disposable VM/host, patch the container runtime, avoid actual credentials, and rehearse teardown. Reference: https://docs.docker.com/engine/security/

## Scope of intentional weaknesses

Only the fake backup, command search path, and fake batch startup settings are intentionally weak. The harmless proof copies a per-run training token within the same isolated target. There is no reverse shell, password guessing, external exfiltration, remote scanning, credential harvesting from the host, or real operating-system persistence installation.

The fixture's so-called reboot is a batch-service restart. It does not modify systemd, cron, PAM, SSH configuration, or the host boot process. Reset and teardown act only on validated team state and a container whose session ownership label matches.

## Operational limitations

Editing and grading concurrently is unsupported. Normal TERM/EXIT cleanup attempts to restore a temporary command probe; SIGKILL or a lost Docker connection may interrupt restoration. Read the operator recovery guidance. Reset discards all mutable container state and score history. Do not restart/stop the Docker container expecting tmpfs contents to survive.

The Linux namespace test backend deliberately leaves `/proc` empty where a nested proc mount is prohibited. It confirms runtime logic and file/UID behavior, not process-inspection tooling or Docker-specific security guarantees.
