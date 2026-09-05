"""Seven worked rows, then construct an input distinguishing two programs.

For rows 1-7, replace return None with the statement's whole block and return its
final expression. Row 8 supplies the required conditions; construct your own input
by hand or implement binding yourself. Public tests print your own outputs.

m is the wrapping divisor; discounts contains three inputs; limit is the requested
program's maximum accepted total. cases contains four examples and reports contains
someone else's claims. other_program uses the same arithmetic but other_limit.
No cryptographic proof is generated. True means yes; False means no.
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


def binding(m, limit, other_limit):
    """Construct three integers, each 0 through m-1.
    Inputs guarantee 0 <= limit < other_limit < m.
    Their ordinary sum exceeds other_limit. Its remainder by m is greater than
    limit and at most other_limit: only the other program improperly accepts.
    Write your own construction here, or submit a hand-constructed triple directly.
    """
    return None
