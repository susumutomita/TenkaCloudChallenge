"""Hidden tests. Run by /verify against a copy of the learner's recover.py.

The attack is easy to write and easy to write wrongly in ways that still produce a
number. Every extraction checkpoint therefore ends at `confirms` -- an unconfirmed
recovery is a guess -- and the rejection checkpoint feeds pairs that look attackable
and are not.
"""

from __future__ import annotations

import sys
import hashlib
import hmac
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    DOMAINS,
    NONCE_SPACE,
    audit_log,
    challenge,
    message_with_different_challenge,
    messages,
    secret_key,
    sign_with,
    toy_group,
    truncated_nonce,
)
from participant.schnorr import Point  # noqa: E402

LABELS = ("h0", "h1", "h2")


def _reuse_pair(seed: str, label: str, group):
    """Two accepting transcripts under one commitment, built directly."""
    secret = secret_key(seed, f"{label}-pair", group)
    k = 1 + (secret * 3 + 5) % (group.n - 2)
    note_list = messages(seed, f"{label}-pair", 4)
    first = note_list[0]
    second = message_with_different_challenge(
        first,
        note_list[1] + b"-second",
        group.generator.scalar_mul(k),
        group.generator.scalar_mul(secret),
        group,
    )
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
        normalized = {**record, "public_key": group.point(*record["public_key"]), "commitment": group.point(*record["commitment"])}
        # Parsing does not verify a signature: even scalar boundaries must be
        # retained. Exercise each point's raw and normalized form independently.
        class ValidPoint(Point):
            pass

        forms = (tuple, list, lambda xy: group.point(*xy), lambda xy: ValidPoint(group.params, *xy))
        for public_form in forms:
            for commitment_form in forms:
                for response, message in ((0, b""), (record["response"], record["message"]),
                                          (group.n - 1, b"\x00\xff")):
                    candidate = {
                        **record,
                        "message": message,
                        "public_key": public_form(record["public_key"]),
                        "commitment": commitment_form(record["commitment"]),
                        "response": response,
                    }
                    try:
                        parsed = module.parse_record(candidate, group)
                    except Exception as error:  # noqa: BLE001
                        failures.append(f"parsing a valid record raised {type(error).__name__}")
                        continue
                    if not isinstance(parsed, dict) or not all(key in parsed for key in normalized):
                        failures.append("a parsed record must retain all four fields")
                        continue
                    if not isinstance(parsed["message"], bytes) or parsed["message"] != message:
                        failures.append("parsing must preserve the bytes message")
                    if type(parsed["response"]) is not int or parsed["response"] != response:
                        failures.append("parsing must preserve the integer response")
                    for key in ("public_key", "commitment"):
                        point = parsed[key]
                        if (not isinstance(point, Point) or type(point.x) is not int
                                or type(point.y) is not int
                                or point.x != normalized[key].x or point.y != normalized[key].y
                                or not isinstance(point.params, tuple)
                                or any(type(value) is not int for value in point.params)
                                or tuple(point.params) != tuple(normalized[key].params)):
                            failures.append("parsing must normalize both coordinates to the original Points")
        broken = [
            {},
            {"message": b"x", "public_key": (0, 0), "commitment": (0, 0)},
            {**record, "message": "not bytes"},
            {**record, "response": -1},
            {**record, "response": group.n},
            {**record, "public_key": (group.p, 0)},
            {**record, "commitment": (1, 1)},
        ]
        broken.extend({k:v for k,v in record.items() if k != missing}
                      for missing in ("message", "public_key", "commitment", "response"))
        broken.extend({**record, "response": value} for value in (True, False, 1.0, "1", None))
        broken.extend((None, [], "record"))
        good_point = normalized["public_key"]
        invalid_points = (
            group.infinity(),
            Point(good_point.params, "x", good_point.y),
            Point(good_point.params, good_point.x, "y"),
            Point(good_point.params, None, good_point.y),
            Point(good_point.params, True, good_point.y),
            Point((group.p, group.a + 1, group.b), good_point.x, good_point.y),
            Point(good_point.params, good_point.x + group.p, good_point.y),
            next(group.point(a, b) for a in range(group.p) for b in range(group.p)
                 if not group.contains(group.point(a, b))),
        )
        for key in ("public_key", "commitment"):
            broken.extend({**normalized, key: point} for point in invalid_points)
            x, y = record[key]
            for value in (None, 1, "point", {}, (), (x,), (x, y, 0)):
                broken.append({**record, key: value})
            for pair_type in (tuple, list):
                for coordinates in ((-1, y), (x, -1), (x + group.p, y), (x, y + group.p),
                                    (float(x), y), (x, float(y)), (str(x), y), (x, None)):
                    broken.append({**record, key: pair_type(coordinates)})
            # Exercise the raw tuple/list branch too, including coordinates whose
            # integer equivalents are on the curve. Python bool is an int subclass.
            for pair_type in (tuple, list):
                for boolean in (False, True):
                    for other in range(group.p):
                        broken.append({**record, key: pair_type((boolean, other))})
                        broken.append({**record, key: pair_type((other, boolean))})
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
        records = list(log["records"])
        secret, first, second = _reuse_pair(seed, label, group)
        records.extend([first, dict(first)])
        clean = [sign_with(1 + i, secret, f"clean-{i}".encode(), group) for i in range(4)]
        invalid = {**second, "response": (second["response"] + 1) % group.n}
        cases = [(records, True), ([first, second], True), ([{}, first, None, second], True)]
        cases.extend((rows, False) for rows in
                     ([], [{}], [first], [first, dict(first)], [first, invalid], clean))
        for rows, has_reuse in cases:
            try:
                # Keep the original evidence even if a learner filters their
                # argument in place and accidentally renumbers the result.
                pairs = module.find_reuse(deepcopy(rows), group)
            except Exception as error:  # noqa: BLE001
                failures.append(f"scanning the log raised {type(error).__name__}")
                continue
            if not isinstance(pairs, list):
                failures.append("reuse detection must return a list, empty when no pair exists")
                continue
            if bool(pairs) != has_reuse:
                failures.append("reuse detection must find an attackable pair and return [] when none exists")
            for pair in pairs:
                # Validate evidence before indexing: Python accepts negative and
                # boolean indices, but neither is an original log row number.
                if (not isinstance(pair, (tuple, list)) or len(pair) != 2
                        or any(type(i) is not int or not 0 <= i < len(rows) for i in pair)
                        or pair[0] == pair[1]):
                    failures.append("a reuse pair must contain two distinct original record indices")
                    break
                a, b = (rows[i] for i in pair)
                try:
                    valid = (a["commitment"] == b["commitment"]
                             and a["public_key"] == b["public_key"]
                             and _really_accepts(a, group) and _really_accepts(b, group))
                    if valid:
                        public, commitment = group.point(*a["public_key"]), group.point(*a["commitment"])
                        valid = challenge(DOMAINS[0], commitment, public, a["message"], group) != challenge(DOMAINS[0], commitment, public, b["message"], group)
                except (KeyError, TypeError, ValueError, AttributeError):
                    valid = False
                if not valid:
                    failures.append("cited records must be accepting transcripts with the same key and commitment and different challenges")
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
        cases = [
            (candidate, form, expected)
            for form in [(public.x, public.y), {"public_key": public}, public]
            for candidate, expected in ((secret, True), ((secret + 1) % group.n, False))
        ] + [(secret, group.generator, public == group.generator)]
        for candidate, form, expected in cases:
            try:
                result = module.confirms(candidate, form, group)
            except Exception as error:
                failures.append(f"confirms raised {type(error).__name__}")
                continue
            if type(result) is not bool:
                failures.append("confirms must return a boolean")
            elif result is not expected:
                failures.append("the confirmation does not match the supplied public key")
    return failures


def check_reject(module, seed: str) -> list[str]:
    """Pairs that look attackable and are not."""
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        secret, first, second = _reuse_pair(seed, label, group)
        parsed_first = module.parse_record(dict(first), group)
        # This independent checkpoint must distinguish, not simply reject everything.
        try:
            recovered = module.recover_secret(first, second, group)
            pairs = module.find_reuse([first, second], group)
            if type(recovered) is not int or recovered % group.n != secret % group.n:
                failures.append("a valid reused pair must remain recoverable")
            if not isinstance(pairs, list) or not any(pair in [(0, 1), (1, 0), [0, 1], [1, 0]] for pair in pairs):
                failures.append("a valid reused pair must remain discoverable")
        except Exception:
            failures.append("the rejection guards rejected a valid reused pair")

        malformed = [None, {}, [], {**first, "response": "bad"}]
        malformed.extend({k:v for k,v in first.items() if k != missing}
                         for missing in ("message", "public_key", "commitment", "response"))
        for bad in malformed:
            for left, right in ((bad, second), (first, bad)):
                try:
                    module.recover_secret(left, right, group)
                    failures.append("invalid recovery inputs were accepted")
                except module.MalformedRecord:
                    pass
                except Exception:
                    failures.append("recovery did not follow its input error contract")

        invalid = module.parse_record(dict(second), group)
        invalid["response"] = (invalid["response"] + 1) % group.n
        for left, right in ((parsed_first, invalid), (invalid, parsed_first)):
            try:
                module.recover_secret(left, right, group)
                failures.append("a rejected transcript was used for recovery")
            except module.MalformedRecord:
                pass
            except Exception as error:
                failures.append(f"invalid transcript recovery raised {type(error).__name__}")
        # Valid signatures by one signer with different nonces cannot cancel k.
        for nonce in range(1, group.n):
            different = sign_with(nonce, secret, b"different commitment", group)
            parsed_different = module.parse_record(dict(different), group)
            if parsed_different["commitment"] == parsed_first["commitment"]:
                continue
            from participant.schnorr import DOMAINS, challenge
            if challenge(DOMAINS[0], parsed_first["commitment"], parsed_first["public_key"], parsed_first["message"], group) == challenge(DOMAINS[0], parsed_different["commitment"], parsed_different["public_key"], parsed_different["message"], group):
                continue
            try:
                module.recover_secret(parsed_first, parsed_different, group)
                failures.append("different commitments were accepted for recovery")
            except module.MalformedRecord:
                pass
            except Exception:
                failures.append("different commitments did not follow the rejection contract")
            break
        else:
            raise AssertionError("no valid mismatched-commitment test pair")

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
                module.recover_secret(parsed_first, foreign, group)
                failures.append("a cross-signer pair must raise MalformedRecord")
            except module.MalformedRecord:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"a cross-signer pair raised {type(error).__name__}")

        # Independently scored rejection must also enforce the detector's guards.
        for rows in ([first, dict(first)], [first, sign_with(k, other_secret, b"elsewhere", group)]):
            try:
                result = module.find_reuse(deepcopy(rows), group)
                if not isinstance(result, list) or result:
                    failures.append("equal-challenge and cross-signer logs must return an empty list")
            except Exception:
                failures.append("an unsolvable log must be skipped without raising")

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
        known_secret, valid, _ = _reuse_pair(seed, label, group)
        clean = [sign_with(1 + i, known_secret, f"clean-{i}".encode(), group) for i in range(4)]
        for unattackable in ([], clean, [valid, dict(valid)], [{}]):
            try:
                if module.attack_log(unattackable, group) != {}:
                    failures.append("an unattackable log must return an empty result")
            except Exception:
                failures.append("an unattackable log must not raise")
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
        indices = result.get("records")
        records = log["records"]
        if (not isinstance(indices, (list, tuple)) or len(indices) != 2
                or any(type(i) is not int or not 0 <= i < len(records) for i in indices)
                or indices[0] == indices[1]):
            failures.append("the attack must cite two distinct original record indices")
            continue
        a, b = (records[i] for i in indices)
        try:
            valid = (tuple(a["public_key"]) == expected == tuple(b["public_key"])
                     and a["commitment"] == b["commitment"]
                     and _really_accepts(a, group) and _really_accepts(b, group))
            if valid:
                public, commitment = group.point(*a["public_key"]), group.point(*a["commitment"])
                valid = challenge(DOMAINS[0], commitment, public, a["message"], group) != challenge(DOMAINS[0], commitment, public, b["message"], group)
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            failures.append("the cited records must be an accepted reuse pair for the recovered key")

    return failures


def check_collision(module, seed: str) -> list[str]:
    """The measurement has to be the generator's, not a plausible-looking number."""
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        for samples in (0, 1, 2, 7, 40, 65):
            calls = []
            generator_code = truncated_nonce.__code__
            previous_profile = sys.getprofile()
            def observe(frame, event, arg):
                if event == "call" and frame.f_code is generator_code:
                    args = frame.f_locals
                    calls.append((args["seed"], args["secret"], args["message"], args["group"]))
                if previous_profile is not None:
                    previous_profile(frame, event, arg)
            try:
                sys.setprofile(observe)
                result = module.collision_experiment(f"{seed}:{label}", group, samples)
            except Exception as error:
                failures.append(f"the collision experiment raised {type(error).__name__}")
                continue
            finally:
                sys.setprofile(previous_profile)
            expected_calls = [(f"{seed}:{label}", 1, f"trial-{i}".encode(), group)
                              for i in range(samples)]
            if len(calls) != samples or any(
                type(actual[0]) is not str or actual[0] != want[0]
                or type(actual[1]) is not int or actual[1] != 1
                or type(actual[2]) is not bytes or actual[2] != want[2]
                or actual[3] is not group
                for actual, want in zip(calls, expected_calls)
            ):
                failures.append("the experiment must call the supplied generator for each documented trial in order")
            if not isinstance(result, dict):
                failures.append("the experiment reported nothing")
                continue
            if any(type(result.get(key)) is not int for key in ("space", "distinct", "collisions")):
                failures.append("the experiment must report three integer counts, not booleans")
                continue
            if result["space"] != NONCE_SPACE:
                failures.append("the reported nonce space is not the generator's")
                continue
            distinct, collisions = result["distinct"], result["collisions"]
            if distinct + collisions != samples:
                failures.append("the counts do not add up to the number of samples drawn")
                continue
            expected_values = {
                truncated_nonce(f"{seed}:{label}", 1, f"trial-{i}".encode(), group)
                for i in range(samples)
            }
            if distinct != len(expected_values) or collisions != samples - len(expected_values):
                failures.append("the counts do not match the documented experiment")
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
        witness_seed = f"{seed}:{label}:repair-witness"
        try:
            pair = module.repair_witness(witness_seed, group)
            if not isinstance(pair, (tuple, list)) or len(pair) != 2 or any(type(i) is not int or not 0 <= i <= 64 for i in pair) or pair[0] == pair[1]:
                failures.append("repair witness must contain two different allowed indices")
            elif truncated_nonce(witness_seed, 1, f"trial-{pair[0]}".encode(), group) != truncated_nonce(witness_seed, 1, f"trial-{pair[1]}".encode(), group):
                failures.append("repair witness inputs do not collide under the weak generator")
        except Exception:
            failures.append("repair witness could not be evaluated")
        secret = secret_key(seed, f"{label}-repair", group)
        note_list = [b"", b"\x00\xff", *[f"payment {index}".encode() for index in range(60)]]
        produced: dict[int, bytes] = {}
        for note in note_list:
            try:
                k = module.safe_nonce(secret, note, group)
            except Exception as error:  # noqa: BLE001
                return [f"the repaired generator raised {type(error).__name__}"]
            if not isinstance(k, int) or not 1 <= k <= group.n - 1:
                failures.append("a nonce is outside [1, n-1]")
                break
            width = (group.n.bit_length() + 7) // 8
            data = b"nonce-drill-v1" + len(note).to_bytes(8, "big") + note
            digest = hmac.new(secret.to_bytes(width, "big"), data, hashlib.sha256).digest()
            expected = 1 + int.from_bytes(digest, "big") % (group.n - 1)
            if k != expected:
                failures.append("the nonce differs from the stated HMAC-SHA256 construction")
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
