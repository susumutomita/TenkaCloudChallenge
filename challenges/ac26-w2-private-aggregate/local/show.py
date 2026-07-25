"""`make inspect` — your setting, the shape of what you are handed, and your token."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import health_token, inputs_shared, setting, triples

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    st = setting(SEED)
    shared = inputs_shared(SEED, "public", st)
    triple_list = triples(SEED, "public", st, st.parties)
    print("health token  :", health_token(SEED))
    print("field p       :", st.p)
    print("organizations :", st.parties)
    print("public bias   :", st.bias)
    print()
    print("what your protocol is handed (values shown are shares, not secrets):")
    print(json.dumps({
        "counts[0]": shared["counts"][0],
        "severities[0]": shared["severities"][0],
        "triple[0].a": triple_list[0].a,
        "triple[0].b": triple_list[0].b,
        "triple[0].c": triple_list[0].c,
    }, indent=2))
    print()
    print(f"score = sum of {st.parties} products, plus a public bias, mod {st.p}")
    print()
    print("Both factors of every product are secret. Count the multiplications, then")
    print("count the rounds. They are not the same number, and only one of them is")
    print("forced by the expression.")


if __name__ == "__main__":
    main()
