"""Verifier-only fixed practice records, separate from the ideal random experiment.

The secrecy claim assumes a full-range uniform mask independent of the original,
kept secret and used once. Hash-derived practice values do not prove that distribution.
"""
from __future__ import annotations

import hashlib
import re

GRADED = ("add", "mul", "cover", "uncover", "every", "count", "reuse", "leak")
LINES = GRADED
TUPLE_LINES = {"add": 3, "mul": 3, "every": 3, "reuse": 3}


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    n = _draw(seed, "n", 5, 9)
    u = _draw(seed, "u", n + 3, 3 * n)
    v = _draw(seed, "v", n + 3, 3 * n)
    if u % n == 0:
        u -= 1
    if v % n == 0:
        v -= 1
    secret = _draw(seed, "secret", 0, n - 1)
    cover = _draw(seed, "cover", 0, n - 1)
    observed = (secret + cover) % n
    candidates = (secret, (secret + 1) % n, (observed + 3) % n)
    # A separate record: actual second original and common mask are not public.
    known_first = _draw(seed, "reuse-first", 0, n - 1)
    second = (known_first + _draw(seed, "reuse-gap", 1, n - 1)) % n
    reused_cover = _draw(seed, "reuse-cover", 0, n - 1)
    seen1 = (known_first + reused_cover) % n
    seen2 = (second + reused_cover) % n
    public = dict(n=n, u=u, v=v, secret=secret, cover=cover,
                  known_first=known_first, seen1=seen1, seen2=seen2)
    expected = {
        "add": ((u + v) % n, (u % n + v % n) % n, 0),
        "mul": ((u * v) % n, (u % n) * (v % n) % n, 0),
        "cover": observed,
        "uncover": (observed - cover) % n,
        "every": tuple((observed - candidate) % n for candidate in candidates),
        "count": n,
        "leak": second,
    }
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    return "\n".join(f"{name} = {value}" for name, value in setting(seed)["public"].items())


def normalize_answer(line: str, raw: object):
    """Integers only; do not truncate floats, coerce booleans or omit empty entries."""
    width = TUPLE_LINES.get(line)
    if width is None:
        if type(raw) is int:
            return raw
        if isinstance(raw, str) and re.fullmatch(r"[+-]?[0-9]+", raw.strip()):
            return int(raw.strip())
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if (text.startswith("[") and text.endswith("]")) or (text.startswith("(") and text.endswith(")")):
            text = text[1:-1]
        parts = text.split(",")
        if not all(re.fullmatch(r"[+-]?[0-9]+", part.strip()) for part in parts):
            return None
        values = tuple(int(part.strip()) for part in parts)
    elif isinstance(raw, (tuple, list)) and all(type(part) is int for part in raw):
        values = tuple(raw)
    else:
        return None
    return values if len(values) == width else None


def valid_reuse(public: dict, answer: object) -> bool:
    """A different explanation satisfying the public two-observation equations."""
    if not isinstance(answer, (tuple, list)) or len(answer) != 3:
        return False
    n = public["n"]
    if any(type(value) is not int or not 0 <= value < n for value in answer):
        return False
    a, b, mask = answer
    return (a != public["known_first"]
            and (a + mask) % n == public["seen1"]
            and (b + mask) % n == public["seen2"])
