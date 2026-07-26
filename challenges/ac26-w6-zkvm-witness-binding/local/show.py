"""`make inspect` — your statement, your machine, your image, and the shape of a journal.

Everything printed here is public by construction: it is the half of a proof that a verifier
reads. The private half is not printed, and neither is any answer — which image is the same
program as which, which receipt verifies, and which run gave the witness away are the
checkpoints, so this file shows you the objects and not the verdicts.

The one thing it does answer is the collision, because the collision is the premise rather than
the exercise: two real accounts whose statements are the same bytes under an encoder with no
length prefixes. Seeing it once is what makes the first checkpoint a specification instead of a
formatting chore.

The arithmetic and the encoding below are written out here rather than imported from the
reference guest, so running this gives away no part of the file you are asked to write.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    CHANNELS,
    DOMAINS,
    GUEST_VERSIONS,
    IMAGE_COMMITMENT_DOMAIN,
    JOURNAL_FIELDS,
    MEASUREMENT_NAMES,
    OVERFLOWS,
    PARAM_NAMES,
    PUBLIC_NAMES,
    SEMANTICS,
    STATEMENT_COMMITMENT_DOMAIN,
    STATEMENT_FIELDS,
    WIDTHS,
    collision_pair,
    decode_program,
    disclosures,
    health_token,
    image,
    naive_encode,
    replay_cases,
    sibling_images,
    statement,
    statement_family,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    record = statement(SEED, "public")
    profile = SEMANTICS[record["semantics"]]
    built = image(SEED, "public")
    program = decode_program(built["body"])
    left, right = collision_pair(SEED, "public")

    print("== the public statement ==")
    for field in STATEMENT_FIELDS:
        value = record[field]
        shown = value if field != "imageDigest" else f"{value[:16]}... ({len(value)} hex chars)"
        print(f"  {field:12s} {shown}")
    print("  These six fields, in this order, are what a canonical encoding emits. The witness")
    print("  is not among them: the statement says what is asserted, and the proof says that")
    print("  somebody knew an input making it true.")
    print()

    print("== your machine ==")
    print(f"  width     {profile['width']} bits   ({profile['semanticsId']})")
    print(f"  modulus   {profile['modulus']}   <- what an operation wraps at")
    print(f"  max       {profile['max']}   <- the largest value it can hold")
    print(f"  overflow  {profile['overflow']}")
    print(f"  the widths a checkpoint may draw from: {', '.join(str(w) for w in WIDTHS)}")
    print(f"  the overflow behaviours a statement may name: {', '.join(OVERFLOWS)}")
    print("  None of those widths is 8, 16, 32 or 64. A familiar mask is somebody else's")
    print("  machine, and so is one overflow behaviour written in where a profile was named.")
    print()

    print("== the account, and the program that spends it ==")
    for name in PARAM_NAMES:
        print(f"  {name:9s} {record['params'][name]}")
    print()
    print("  order(quantity):  cost  = price * quantity      <- wrap site 'mul'")
    print("                    total = spent + cost          <- wrap site 'add'")
    print("                    if total <= budget: deliver(quantity); spent = total")
    print()
    print("  the security property, over plain integers where nothing wraps:")
    print("    spent + price * quantity <= budget")
    print()

    print("== two statements one encoder cannot tell apart ==")
    print(f"  left    price={left['params']['price']:<4d} spent={left['params']['spent']:<4d} "
          f"budget={left['params']['budget']}")
    print(f"  right   price={right['params']['price']:<4d} spent={right['params']['spent']:<4d} "
          f"budget={right['params']['budget']}")
    print(f"  same statement?      {left == right}")
    print(f"  same naive bytes?    {naive_encode(left) == naive_encode(right)}")
    print("  the parameters, run together with nothing between them:")
    for name, member in (("left ", left), ("right", right)):
        joined = " + ".join(f'"{member["params"][key]}"' for key in PARAM_NAMES)
        run_together = "".join(str(member["params"][key]) for key in PARAM_NAMES)
        print(f"    {name}  {joined}  ->  {run_together}")
    print("  Both are real accounts. Both have real exploits. Concatenate the decimal")
    print("  parameters with no lengths between them and the two disagreements cancel, digit")
    print("  for digit -- so a proof about one verifies against the other, and nothing in the")
    print("  cryptography is broken while that happens.")
    family = len(statement_family(SEED, "public"))
    print(f"  the statement family your encoder has to separate: {family} members")
    print()

    print("== the image, and the four next to it ==")
    print(f"  imageId     {built['imageId']}")
    print(f"  sourcePath  {built['sourcePath']}")
    print(f"  buildId     {built['buildId']}")
    print(f"  steps       {len(program)}   {' -> '.join(program)}")
    print("  the four siblings, each differing in exactly one way:")
    for name, sibling in sibling_images(SEED, "public").items():
        print(f"    {name:11s} sourcePath={sibling['sourcePath']!r} buildId={sibling['buildId']}")
    print("  Which of them are the same program is the checkpoint, so it is not printed here.")
    print(f"  commitment domains: image={IMAGE_COMMITMENT_DOMAIN}")
    print(f"                      statement={STATEMENT_COMMITMENT_DOMAIN}")
    print(f"  the protocol namespaces a claim can be made in: {', '.join(DOMAINS)}")
    print(f"  the guest builds a claim can be made under: {', '.join(GUEST_VERSIONS)}")
    print()

    print("== the runner's two doors ==")
    print("  recorded in env.transcript():   public(name, value)  variable(name, value)")
    print("                                  note(label, **values)")
    print("  not recorded:                   hint(name, value)    write_private(payload)")
    print("  A hint reaches the guest and is not evidence of anything: the host is the party")
    print("  being proved about, and its account of the run is an input to the guest's work")
    print("  rather than a substitute for it.")
    print()

    print("== what a run publishes ==")
    print(f"  journal fields   {', '.join(JOURNAL_FIELDS)}")
    print(f"  measurements     {', '.join(MEASUREMENT_NAMES)}")
    print("  A measurement is safe exactly when a reader could already compute it from the")
    print("  public image. Not 'is it small', and not 'is it just a number'.")
    print()

    print("== the receipts you will be offered ==")
    print(f"  {', '.join(case['id'] for case in replay_cases(SEED, 'public'))}")
    print("  Each is sealed under one statement and offered against another, or sealed and")
    print("  then edited. Which of them a verifier may accept is the checkpoint.")
    print()

    print("== the runs you will audit ==")
    print(f"  {', '.join(entry['id'] for entry in disclosures(SEED, 'public'))}")
    print(f"  channels      {', '.join(CHANNELS)}")
    print(f"  public names  {', '.join(PUBLIC_NAMES)}")
    print("  All of them produced the same journal claim and all of them are correct. Which")
    print("  ones gave the witness away, and under which approved name, is the checkpoint.")
    print()

    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
