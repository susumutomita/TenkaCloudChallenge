# Secure OTA rollback architecture

## Scope

This is a deterministic, teaching-scale model of update protection, detection,
and recovery. It models one vehicle with one TCU and two ECUs. It deliberately
does not model a cellular network, hardware root of trust, production key
ceremony, secure boot ROM, Uptane metadata roles, or regulatory approval.

## Topology

```text
learner / verifier
       |
       v
OTA workshop -----> signing service
       |
       v
      TCU -----> user-space bus -----> ECU A
                         |-----------> ECU B (depends on ECU A version)
```

Only the OTA container has host ports. Internal service names resolve only on
the Docker-internal network, which has no external route. The signing private
key exists only in signer memory; ECU containers fetch the public key from its
internal endpoint at startup.

## Package contract

The signing service canonicalizes and signs a manifest containing:

- campaign ID;
- target ECU ID;
- monotonically comparable version;
- ECU dependencies and minimum versions;
- SHA-256 payload hash.

Boot health is an ECU-local observation and is deliberately absent from the
publisher-controlled manifest. Ed25519 authenticates the canonical manifest.
SHA-256 checks that the payload
matches that authenticated metadata. Neither control substitutes for target,
version, or dependency authorization at the ECU.

## ECU state machine

```text
known-good active slot
        |
        v
validate target + hash + signature + version + dependencies
        |
        v
write inactive slot -> boot/health gate
                         | healthy       -> promote active + known-good
                         | unhealthy     -> retain failed evidence,
                                           restore active known-good
```

The initial learner policy disables several acceptance checks and would leave
an unhealthy image active after the boot-failure scenario. Reset always
reconstructs version 1 in slot A, an empty slot B, zero installs, and the
original unsafe policy.

## TCU state machine

The TCU orders packages from their dependency graph and sends each package
through the bus. ECU B independently reads ECU A's live internal state before
accepting a dependency; inventory supplied by the delivery caller is ignored.
A transient delivery failure increments a bounded retry cycle. Hardened resume
keeps the set of completed ECUs and queues only unfinished work; the inherited
policy clears the set and repeats completed installs.

The lab enforces a hard retry ceiling even when the learner policy is unsafe so
a mistake cannot consume unbounded local resources.

## Fault model

The user-space bus has a bounded counter for one ECU. Each matching delivery
decrements the counter and returns a deterministic transient disconnect. It
does not randomly alter messages. Package alteration, missing signatures,
downgrades and dependency failures are separate OTA fixtures. Health failure is
injected and observed inside the ECU after the inactive slot is written, which
keeps publisher metadata separate from boot evidence.

## Audit contract

Every event has a timestamp, component/actor, action, result, and correlation
ID. A valid trace uses one root correlation ID across signing, OTA, TCU, bus,
ECU A, and ECU B and keeps nondecreasing event order from scenario start to
scenario finish. Local component details may be added, but they cannot replace
the root operation ID.

## Trust boundaries

1. **Release boundary:** only signing holds the private key; OTA receives a
   signed package, not key material.
2. **Cloud-to-vehicle boundary:** TCU schedules and retries but cannot make a
   package authentic.
3. **Vehicle-bus boundary:** delivery is untrusted input to each ECU; the ECU
   revalidates locally.
4. **Boot boundary:** writing an image does not authorize promotion; the health
   gate controls active/known-good pointers.
5. **Evidence boundary:** a successful HTTP response is not sufficient without
   correlated component events and terminal ECU state.

## Resource bounds

Each container is limited to 0.5 CPU, 96 MiB memory, 64 PIDs, a 16 MiB tmpfs,
and a read-only root filesystem. HTTP request bodies, bus delivery logs, audit
state, retries, and operation concurrency are bounded. No host path or external
network is mounted.
