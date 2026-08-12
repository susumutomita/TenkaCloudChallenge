"""Hidden tests. Run by /verify against a copy of the learner's gmw.py.

The interesting checks are not "the chosen message comes back" -- that is plumbing.
They are the protocol's two promises plus the wiring of the AND:

  * `check_request` includes b = 0. A request built from b in 1..q-1 passes every
    happy-path test and leaks the choice: with 0 excluded, choice 0 can never send
    the identity and choice 1 can never send A, so observing either value decides
    the choice. Accepting 0 is what makes both request distributions the whole
    subgroup.
  * `check_wrong_branch` opens the branch the receiver did NOT choose, with the only
    key the receiver has. An encryption that puts both messages under one key
    round-trips perfectly and fails only here.
  * `check_gmw_outputs` verifies each party's output share against the view that
    party actually holds, not only the XOR of the two. The XOR alone cannot see a
    mask cancelled in the wrong party's share: redistributing the same terms between
    z0 and z1 keeps z0 ^ z1 intact while making a share depend on a value its party
    never had.
  * `check_ot_usage` counts OT sessions. A gmw_and that computes the cross terms
    locally produces the right bits in simulation -- it can see everything -- and
    performs zero OTs. The count must be exactly two.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import gmw_setting, ot_setting  # noqa: E402

LABELS = ("h0", "h1", "h2", "h3")

#: Group-element checks below reuse the sender key A = g^a of each label's setting.
_NOT_AN_ELEMENT = ("zero", "modulus", "outside", "wrong-subgroup")


def _bad_elements(p: int, q: int) -> list[int]:
    """Values that must be rejected as A: 0, p, p+3, and a non-residue.

    In a safe-prime group every non-square generates the full order-2q group, not
    the order-q subgroup, so the smallest non-residue is a well-formed-looking int
    that fails the subgroup test.
    """
    non_residue = next(v for v in range(2, p) if pow(v, q, p) != 1)
    return [0, p, p + 3, non_residue]


def check_request(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = ot_setting(seed, label)
        p, q, g, a = cfg["p"], cfg["q"], cfg["g"], cfg["a"]
        a_pub = pow(g, a, p)
        for choice in (0, 1):
            for b in (0, 1, cfg["b"], q - 1):
                try:
                    request = module.ot_request(a_pub, choice, b, p, q, g)
                except Exception as error:  # noqa: BLE001
                    return [
                        f"ot_request raised {type(error).__name__} on a valid input "
                        "(b = 0 is a valid receiver secret)"
                    ]
                expected = pow(g, b, p) if choice == 0 else (a_pub * pow(g, b, p)) % p
                if request != expected:
                    failures.append("the request does not encode the choice correctly")
                    break
        # Inputs that must be rejected, with ValueError and nothing louder.
        rejects = [
            (a_pub, 2, 1),      # choice outside {0, 1}
            (a_pub, 0, -1),     # b below the range
            (a_pub, 0, q),      # b above the range
        ]
        rejects.extend((bad, 0, 1) for bad in _bad_elements(p, q))
        for bad_pub, bad_choice, bad_b in rejects:
            try:
                module.ot_request(bad_pub, bad_choice, bad_b, p, q, g)
            except ValueError:
                continue
            except Exception as error:  # noqa: BLE001
                failures.append(
                    f"ot_request raised {type(error).__name__} where ValueError was expected"
                )
                break
            else:
                failures.append("ot_request accepted an input it must reject")
                break
    return failures


def _run_ot(module, cfg: dict[str, int], choice: int, b: int) -> tuple[int, list[int]]:
    """One full session with the learner's three functions. Returns (plaintext, cts)."""
    p, q, g = cfg["p"], cfg["q"], cfg["g"]
    a_pub = pow(g, cfg["a"], p)
    request = module.ot_request(a_pub, choice, b, p, q, g)
    cts = module.ot_encrypt(cfg["a"], request, cfg["m0"], cfg["m1"], p, q, g)
    if not isinstance(cts, (list, tuple)) or len(cts) != 2:
        raise AssertionError("ot_encrypt must return two ciphertexts")
    plain = module.ot_decrypt(b, choice, a_pub, list(cts), p, q, g)
    return plain, list(cts)


def check_round_trip(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = ot_setting(seed, label)
        for choice in (0, 1):
            for b in (0, cfg["b"]):
                try:
                    plain, _cts = _run_ot(module, cfg, choice, b)
                except Exception as error:  # noqa: BLE001
                    return [f"the OT session raised {type(error).__name__}"]
                if plain != (cfg["m0"], cfg["m1"])[choice]:
                    failures.append(
                        "the chosen branch does not decrypt to the chosen message"
                    )
    return failures


def check_wrong_branch(module, seed: str) -> list[str]:
    """The branch the receiver did not choose must stay closed to the receiver's key."""
    failures: list[str] = []
    for label in LABELS:
        cfg = ot_setting(seed, label)
        p, q, g = cfg["p"], cfg["q"], cfg["g"]
        a_pub = pow(g, cfg["a"], p)
        for choice in (0, 1):
            b = cfg["b"]
            try:
                _plain, cts = _run_ot(module, cfg, choice, b)
                other = module.ot_decrypt(b, 1 - choice, a_pub, cts, p, q, g)
            except Exception as error:  # noqa: BLE001
                return [f"the OT session raised {type(error).__name__}"]
            if other == (cfg["m0"], cfg["m1"])[1 - choice]:
                failures.append(
                    "the receiver's key opens the branch it never chose"
                )
    return failures


def check_gmw_outputs(module, seed: str) -> list[str]:
    """All 16 share patterns, each output share checked against its party's view.

    Each label runs twice: once with the drawn masks and once with mask0 flipped, so
    every seed is guaranteed a pair with mask0 != mask1 -- the only pairs on which a
    mask cancelled in the wrong party's share is visible at all.
    """
    failures: list[str] = []
    for label in LABELS:
        cfg = gmw_setting(seed, label)
        for mask0, mask1 in ((cfg["mask0"], cfg["mask1"]), (cfg["mask0"] ^ 1, cfg["mask1"])):
            for pattern in range(16):
                x0, x1 = (pattern >> 3) & 1, (pattern >> 2) & 1
                y0, y1 = (pattern >> 1) & 1, pattern & 1
                try:
                    result = module.gmw_and(
                        x0, y0, x1, y1,
                        mask0, mask1,
                        cfg["a01"], cfg["b01"], cfg["a10"], cfg["b10"],
                        cfg["p"], cfg["q"], cfg["g"],
                    )
                except Exception as error:  # noqa: BLE001
                    return [f"gmw_and raised {type(error).__name__}"]
                if not isinstance(result, (list, tuple)) or len(result) != 2:
                    return ["gmw_and did not return one output share per party"]
                z0, z1 = result
                if z0 not in (0, 1) or z1 not in (0, 1):
                    failures.append("an output share is not a bit")
                    break
                if (z0 ^ z1) != ((x0 ^ x1) & (y0 ^ y1)):
                    failures.append("the output shares do not XOR to the AND")
                    break
                t01 = mask0 ^ (x0 & y1)
                t10 = mask1 ^ (x1 & y0)
                if z0 != ((x0 & y0) ^ mask0 ^ t10) or z1 != ((x1 & y1) ^ mask1 ^ t01):
                    failures.append(
                        "an output share uses a value its party does not hold "
                        "(a mask cancelled in the wrong share still XORs to the AND)"
                    )
                    break
            else:
                continue
            break
    return failures


def check_ot_usage(module, seed: str) -> list[str]:
    """gmw_and must carry each cross term through the module's own OT, twice in total."""
    cfg = gmw_setting(seed, LABELS[0])
    calls = {"request": 0, "encrypt": 0, "decrypt": 0}
    original = (module.ot_request, module.ot_encrypt, module.ot_decrypt)

    def counted_request(*args, **kwargs):
        calls["request"] += 1
        return original[0](*args, **kwargs)

    def counted_encrypt(*args, **kwargs):
        calls["encrypt"] += 1
        return original[1](*args, **kwargs)

    def counted_decrypt(*args, **kwargs):
        calls["decrypt"] += 1
        return original[2](*args, **kwargs)

    module.ot_request = counted_request
    module.ot_encrypt = counted_encrypt
    module.ot_decrypt = counted_decrypt
    try:
        module.gmw_and(
            1, 0, 0, 1,
            cfg["mask0"], cfg["mask1"],
            cfg["a01"], cfg["b01"], cfg["a10"], cfg["b10"],
            cfg["p"], cfg["q"], cfg["g"],
        )
    except Exception as error:  # noqa: BLE001
        return [f"gmw_and raised {type(error).__name__}"]
    finally:
        module.ot_request, module.ot_encrypt, module.ot_decrypt = original
    if calls != {"request": 2, "encrypt": 2, "decrypt": 2}:
        return [
            "gmw_and must run exactly two OT sessions through ot_request / "
            f"ot_encrypt / ot_decrypt (observed {calls['request']}/{calls['encrypt']}/"
            f"{calls['decrypt']})"
        ]
    return []


def run(module, seed: str) -> list[str]:
    return [
        *check_request(module, seed),
        *check_round_trip(module, seed),
        *check_wrong_branch(module, seed),
        *check_gmw_outputs(module, seed),
        *check_ot_usage(module, seed),
    ]
