"""Hidden tests. Run by /verify against a copy of the learner's recover.py.

The attack is easy to write and easy to write wrongly in ways that still produce a
number. Every extraction checkpoint therefore ends at `confirms` -- an unconfirmed
recovery is a guess -- and the rejection checkpoint feeds pairs that look attackable
and are not.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    DOMAINS,
    NONCE_SPACE,
    audit_log,
    challenge,
    messages,
    secret_key,
    sign_with,
    toy_group,
    truncated_nonce,
)

LABELS = ("h0", "h1", "h2")


def _reuse_pair(seed: str, label: str, group):
    """Two accepting transcripts under one commitment, built directly."""
    secret = secret_key(seed, f"{label}-pair", group)
    k = 1 + (secret * 3 + 5) % (group.n - 2)
    note_list = messages(seed, f"{label}-pair", 4)
    first, second = note_list[0], note_list[1] + b"-second"
    return (
        secret,
        sign_with(k, secret, first, group),
        sign_with(k, secret, second, group),
    )


def check_parse(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        _secret, record, _other = _reuse_pair(seed, label, group)
        try:
            parsed = module.parse_record(dict(record), group)
        except Exception as error:  # noqa: BLE001
            return [f"parsing a valid record raised {type(error).__name__}"]
        if not isinstance(parsed, dict) or "response" not in parsed:
            failures.append("a valid record did not parse")
            continue
        if parsed["response"] != record["response"]:
            failures.append("the parsed response is not the record's response")
        broken = [
            {},
            {"message": b"x", "public_key": (0, 0), "commitment": (0, 0)},
            {**record, "message": "not bytes"},
            {**record, "response": -1},
            {**record, "response": group.n},
            {**record, "public_key": (group.p, 0)},
            {**record, "commitment": (1, 1)},
        ]
        for candidate in broken:
            try:
                module.parse_record(candidate, group)
                failures.append("a malformed record parsed without complaint")
                break
            except module.MalformedRecord:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"a malformed record raised {type(error).__name__}")
                break
    return failures


def _really_accepts(record, group) -> bool:
    """Ground truth, computed here rather than by calling the submission's `accepts`.

    Asking the submission whether its own findings are valid would be circular: an
    implementation that never checks acceptance would certify its own bad pairs.
    """
    public = group.point(*record["public_key"])
    commitment = group.point(*record["commitment"])
    e = challenge(DOMAINS[0], commitment, public, record["message"], group)
    left = group.generator.scalar_mul(record["response"])
    return left == commitment + public.scalar_mul(e)


def check_detect(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        log = audit_log(seed, label, group)
        try:
            pairs = module.find_reuse(list(log["records"]), group)
        except Exception as error:  # noqa: BLE001
            return [f"scanning the log raised {type(error).__name__}"]
        if not isinstance(pairs, list) or not pairs:
            failures.append("the reused commitment was not found")
            continue
        records = log["records"]
        for left, right in pairs:
            a, b = records[left], records[right]
            if a["commitment"] != b["commitment"]:
                failures.append("a reported pair does not share a commitment")
                break
            if a["public_key"] != b["public_key"]:
                failures.append("a reported pair is not from the same signer")
                break
            # The log contains a record that parses cleanly, shares the reused
            # commitment and key, and does not verify. Reuse inside a rejected
            # transcript proves nothing, so pairing it is a finding that is not one.
            if not _really_accepts(a, group) or not _really_accepts(b, group):
                failures.append("a reported pair includes a transcript that does not verify")
                break
    return failures


def check_extract(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        secret, first, second = _reuse_pair(seed, label, group)
        parsed = [module.parse_record(dict(record), group) for record in (first, second)]
        try:
            recovered = module.recover_secret(parsed[0], parsed[1], group)
        except Exception as error:  # noqa: BLE001
            return [f"the extraction raised {type(error).__name__}"]
        if recovered % group.n != secret % group.n:
            failures.append("the recovered scalar is not the signer's secret")
            continue
        # Order must not matter: swapping the two negates both differences.
        if module.recover_secret(parsed[1], parsed[0], group) % group.n != secret % group.n:
            failures.append("the extraction depends on which transcript comes first")
    return failures


def check_confirm(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        secret, first, _second = _reuse_pair(seed, label, group)
        public = group.generator.scalar_mul(secret)
        if not module.confirms(secret, public, group):
            failures.append("the correct secret was not confirmed against its public key")
        if module.confirms((secret + 1) % group.n, public, group):
            failures.append("a wrong secret was confirmed against a public key")
        if module.confirms(secret, group.generator, group) and public != group.generator:
            failures.append("a secret was confirmed against somebody else's public key")
    return failures


def check_reject(module, seed: str) -> list[str]:
    """Pairs that look attackable and are not."""
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        secret, first, second = _reuse_pair(seed, label, group)
        parsed_first = module.parse_record(dict(first), group)

        # Same commitment AND the same message, so e1 == e2: one equation twice.
        duplicate = module.parse_record(dict(first), group)
        try:
            module.recover_secret(parsed_first, duplicate, group)
            failures.append("two identical transcripts were treated as solvable")
        except module.MalformedRecord:
            pass
        except ZeroDivisionError:
            failures.append("the equal-challenge case fell through to a division by zero")
        except Exception as error:  # noqa: BLE001
            failures.append(f"the equal-challenge case raised {type(error).__name__}")

        # Same commitment, different signer: there is no single x to solve for.
        other_secret = (secret + 3) % (group.n - 1) + 1
        k = 1 + (secret * 3 + 5) % (group.n - 2)
        foreign = module.parse_record(
            dict(sign_with(k, other_secret, b"elsewhere", group)), group
        )
        if not isinstance(foreign, dict) or "public_key" not in foreign:
            failures.append("a valid record did not parse")
            continue
        if foreign["public_key"] != parsed_first["public_key"]:
            try:
                recovered = module.recover_secret(parsed_first, foreign, group)
                if module.confirms(recovered, parsed_first["public_key"], group):
                    failures.append("a cross-signer pair produced a confirmed recovery")
            except module.MalformedRecord:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"a cross-signer pair raised {type(error).__name__}")

        # A log full of honest signatures must yield nothing at all.
        clean = [sign_with(1 + i, secret, f"m{i}".encode(), group) for i in range(1, 5)]
        if module.find_reuse(clean, group):
            failures.append("reuse was reported in a log that has none")
    return failures


def check_hunt(module, seed: str) -> list[str]:
    """The whole attack, against the noisy log."""
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        log = audit_log(seed, label, group)
        try:
            result = module.attack_log(list(log["records"]), group)
        except Exception as error:  # noqa: BLE001
            return [f"attacking the log raised {type(error).__name__}"]
        if not isinstance(result, dict) or "secret" not in result:
            failures.append("the attack came back with nothing")
            continue
        if result["secret"] % group.n != log["victim_secret"] % group.n:
            failures.append("the recovered key is not the victim's")
            continue
        expected = (log["victim_public"].x, log["victim_public"].y)
        if tuple(result.get("public_key", ())) != expected:
            failures.append("the attack did not name whose key it recovered")
    return failures


def check_collision(module, seed: str) -> list[str]:
    """The measurement has to be the generator's, not a plausible-looking number."""
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        samples = 40
        try:
            result = module.collision_experiment(f"{seed}:{label}", group, samples)
        except Exception as error:  # noqa: BLE001
            return [f"the experiment raised {type(error).__name__}"]
        if not isinstance(result, dict):
            failures.append("the experiment reported nothing")
            continue
        if result.get("space") != NONCE_SPACE:
            failures.append("the reported nonce space is not the generator's")
            continue
        distinct = result.get("distinct")
        collisions = result.get("collisions")
        if not isinstance(distinct, int) or not isinstance(collisions, int):
            failures.append("the experiment did not report counts")
            continue
        if distinct + collisions != samples:
            failures.append("the counts do not add up to the number of samples drawn")
            continue
        # With 40 draws from 64 slots, collisions are not a maybe.
        if collisions == 0:
            failures.append("no collision was found, so the generator was not actually run")
    return failures


def check_repair(module, seed: str) -> list[str]:
    """The fixed generator, under the conditions that broke the others.

    Run over secp256k1, and that is not incidental. A toy group has fewer than fifty
    scalars, so sixty messages cannot possibly get sixty distinct nonces -- the
    pigeonhole says so before any code is written. There is no nonce generator that is
    safe in a forty-element group; the group being small IS the vulnerability. Asserting
    distinctness there would be asserting something impossible.
    """
    from fixtures.generate import secp_group

    failures: list[str] = []
    group = secp_group()
    for label in LABELS:
        secret = secret_key(seed, f"{label}-repair", group)
        note_list = [f"payment {index}".encode() for index in range(60)]
        produced: dict[int, bytes] = {}
        for note in note_list:
            try:
                k = module.safe_nonce(secret, note, group)
            except Exception as error:  # noqa: BLE001
                return [f"the repaired generator raised {type(error).__name__}"]
            if not isinstance(k, int) or not 1 <= k <= group.n - 1:
                failures.append("a nonce is outside [1, n-1]")
                break
            if k in produced and produced[k] != note:
                failures.append("two different messages were given the same nonce")
                break
            produced[k] = note
        else:
            # Distinctness over sixty samples is satisfied by a sixteen-bit generator
            # too -- sixty draws from 65536 collide only about three times in a hundred
            # runs, so asserting distinctness alone would let truncation through most of
            # the time. The range is what actually rules it out: with a 256-bit order,
            # every output landing below 2^64 has probability around 2^-11000.
            if produced and max(produced) < (1 << 64):
                failures.append("every nonce fits in 64 bits, so the space was truncated")
            # Same key and message may repeat -- that leaks nothing new, because it
            # produces the same signature. Two different signers of the same message
            # must not, or one can recover the other's key.
            other = (secret + 5) % (group.n - 1) + 1
            if other != secret:
                shared = note_list[0]
                if module.safe_nonce(secret, shared, group) == module.safe_nonce(
                    other, shared, group
                ):
                    failures.append("two signers got the same nonce for the same message")
            if module.safe_nonce(secret, note_list[0], group) != module.safe_nonce(
                secret, note_list[0], group
            ):
                failures.append("the repaired generator is not deterministic")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_parse(module, seed),
        *check_detect(module, seed),
        *check_extract(module, seed),
        *check_confirm(module, seed),
        *check_reject(module, seed),
        *check_hunt(module, seed),
        *check_collision(module, seed),
        *check_repair(module, seed),
    ]
