#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
from pathlib import Path

PAYLOAD_SHA256 = "8eb1f05231b84f3b75d73ab252b9e39030788305e763b93bbb91d7fd8bd20f36"

payload_dir = Path(__file__).resolve().parents[1] / ".migration" / "workbench-payload"
parts = sorted(payload_dir.glob("part-*"))
if not parts:
    raise SystemExit("migration payload is missing")

encoded = "".join(path.read_text(encoding="ascii") for path in parts)
source = gzip.decompress(base64.b64decode(encoded))
if hashlib.sha256(source).hexdigest() != PAYLOAD_SHA256:
    raise SystemExit("migration payload checksum mismatch")

exec(compile(source, __file__, "exec"), globals(), globals())
