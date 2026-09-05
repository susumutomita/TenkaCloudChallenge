"""Eight rows about a tiny addition program and the claim made about it.

Use the statement's code blocks in order. Replace return None with the whole
block for that row, adding return before the block's final expression. Run the
public tests to see your own outputs, then submit them in that row's answer field.

m is the wrapping divisor; discounts is the three input numbers; limit is the
largest allowed total. cases holds four lists of inputs and limits. reports
holds another person's claims about those cases. program is the requested program
number. receipts are teaching cards with a prechecked flag, program number and
claim label. They are not real cryptographic proofs. True means yes; False means no.
"""
from __future__ import annotations


def exact(m, discounts):
    """Row 1: add the input numbers without wrapping."""
    return None


def trace(m, discounts):
    """Row 2: start at zero, add one input, reduce by m, record; repeat."""
    return None


def overflow(m, discounts):
    """Row 3: did this step's own sum reach m before reducing?"""
    return None


def decision(m, discounts, limit):
    """Row 4: (machine accepts, ordinary arithmetic accepts)."""
    return None


def exploit(m, cases):
    """Row 5: machine accepts AND the full total exceeds the limit, per case."""
    return None


def predicate(m, cases):
    """Row 6: which cases wrongly pass a check of only full total > limit?"""
    return None


def tamper(m, cases, reports):
    """Row 7: recompute each case; does its reported claim match?"""
    return None


def binding(program, receipts):
    """Row 8: prechecked, expected program, and the exact exploit claim must all match."""
    return None
