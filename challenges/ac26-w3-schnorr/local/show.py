"""`make inspect` — your group, your statement, and the shape of the protocol.

Your secret key and nonce are NOT printed. They are the two values the protocol exists
to protect, and a lab that prints them teaches the opposite of the lesson.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import DOMAINS, health_token, nonce, secp_group, secret_key, toy_group

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    group = toy_group(SEED)
    x = secret_key(SEED, "public", group)
    public = group.generator.scalar_mul(x)
    secp = secp_group()

    print("health token :", health_token(SEED))
    print(f"toy group    : y^2 = x^3 + {group.a}x + {group.b} (mod {group.p})")
    print(f"generator    : ({group.generator.x}, {group.generator.y})")
    print(f"order n      : {group.n}   <- scalars live here, not mod p")
    print(f"your statement (public key P = xG): ({public.x}, {public.y})")
    print("your secret x and nonce k         : not printed, on purpose")
    print()
    print("domains you will be asked about:")
    for domain in DOMAINS:
        print(f"  {domain}")
    print()
    print("the protocol:")
    print("  R = kG                        commitment")
    print("  e = H(domain, R, P, message)  challenge, once it is non-interactive")
    print("  z = k + e*x  (mod n)          response")
    print("  zG == R + eP                  what the verifier checks")
    print()
    print(f"secp256k1 is also used, with n = {secp.n:#x}")
    print()
    print("Note the group orders. On the toy group a forgery succeeds with probability")
    print(f"1/n = 1/{group.n}, which is often enough to see. That is a property of the")
    print("parameters, not of your code, and it is why the checks that must not pass by")
    print("luck are run over secp256k1 instead.")


if __name__ == "__main__":
    main()
