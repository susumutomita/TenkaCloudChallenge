"""A one-line arithmetic language, because the terminal sends one line at a time.

A completion rule is submitted as the expression that has to come out equal to the share
the missing party must hold for the ledger to reach `target`:

    (target - known) % modulus     ->  that expression, evaluated per case
    target % modulus               ->  a rule that ignores what the others already hold

Grammar, the smallest thing that can express a closed form here:

    sum     := product ( ('+' | '-') product )*
    product := unary ( ('*' | '%') unary )*
    unary   := ('-' | '+')* atom
    atom    := integer | name | '(' sum ')'

`%` is the remainder Python computes, and it is the one a finite field is defined by: it
always lands in [0, modulus) even when the left side is negative. That matters directly
here -- `known` is handed over unreduced and is usually larger than the modulus, so
`target - known` is usually negative, and a share is an element of the field.

There is no division and no exponent. Neither is needed, and both are ways for a pasted
line to turn into something that either takes a long time or means something the
participant did not intend.
"""

from __future__ import annotations

from typing import Callable

#: Bounds, so a pasted line cannot turn into a pathological parse. Generous enough
#: that no honest rule comes close.
MAX_SOURCE_LENGTH = 200
MAX_DEPTH = 16

#: Evaluated against a case's parameters; returns the value the rule claims.
Rule = Callable[[dict[str, int]], int]


class ExpressionError(ValueError):
    """A parse, name or arithmetic error, phrased for the participant rather than for a traceback."""


def _tokenize(source: str) -> list[str]:
    tokens: list[str] = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char in "+-*%()":
            tokens.append(char)
            index += 1
            continue
        if char.isdigit():
            start = index
            while index < len(source) and source[index].isdigit():
                index += 1
            tokens.append(source[start:index])
            continue
        if char.isalpha() or char == "_":
            start = index
            while index < len(source) and (source[index].isalnum() or source[index] == "_"):
                index += 1
            tokens.append(source[start:index])
            continue
        if char == "/":
            raise ExpressionError(
                "there is no division here: a finite field is defined with `%`, the "
                "remainder, and `%` is available"
            )
        if char == "=":
            raise ExpressionError(
                "a rule is an expression, not an equation: write what the final value IS, "
                "with no `=` in it"
            )
        raise ExpressionError(f"unexpected character {char!r}")
    return tokens


class _Parser:
    def __init__(self, tokens: list[str], names: tuple[str, ...]) -> None:
        self.tokens = tokens
        self.names = names
        self.position = 0

    def peek(self) -> str | None:
        return self.tokens[self.position] if self.position < len(self.tokens) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise ExpressionError("the expression ends earlier than it should")
        self.position += 1
        return token

    def parse(self) -> Rule:
        node = self.sum(0)
        if self.peek() is not None:
            raise ExpressionError(f"unexpected {self.peek()!r} after the expression")
        return node

    def sum(self, depth: int) -> Rule:
        node = self.product(depth)
        while self.peek() in ("+", "-"):
            operator = self.take()
            right = self.product(depth)
            left = node
            if operator == "+":
                node = lambda values, a=left, b=right: a(values) + b(values)
            else:
                node = lambda values, a=left, b=right: a(values) - b(values)
        return node

    def product(self, depth: int) -> Rule:
        node = self.unary(depth)
        while self.peek() in ("*", "%"):
            operator = self.take()
            right = self.unary(depth)
            left = node
            if operator == "*":
                node = lambda values, a=left, b=right: a(values) * b(values)
            else:
                node = lambda values, a=left, b=right: _remainder(a(values), b(values))
        return node

    def unary(self, depth: int) -> Rule:
        if self.peek() == "-":
            self.take()
            inner = self.unary(depth)
            return lambda values, a=inner: -a(values)
        if self.peek() == "+":
            self.take()
            return self.unary(depth)
        return self.atom(depth)

    def atom(self, depth: int) -> Rule:
        if depth > MAX_DEPTH:
            raise ExpressionError("the expression nests too deeply")
        token = self.take()
        if token == "(":
            inner = self.sum(depth + 1)
            if self.peek() != ")":
                raise ExpressionError("a '(' is never closed")
            self.take()
            return inner
        if token.isdigit():
            value = int(token)
            return lambda _values, v=value: v
        if token in self.names:
            return lambda values, name=token: values[name]
        if token in (")", "*", "%", "+", "-"):
            raise ExpressionError(f"{token!r} is not something a value can start with")
        raise ExpressionError(
            f"unknown name {token!r}; the names are " + ", ".join(self.names)
        )


def _remainder(left: int, right: int) -> int:
    """`%`, with a readable message instead of a ZeroDivisionError traceback."""
    if right == 0:
        raise ExpressionError("`% 0` has no value; the right side of a `%` cannot be zero")
    return left % right


def compile_rule(source: str, names: tuple[str, ...]) -> Rule:
    """Compile one rule. Raises ExpressionError with a reason a participant can act on."""
    if len(source) > MAX_SOURCE_LENGTH:
        raise ExpressionError(f"the expression is longer than {MAX_SOURCE_LENGTH} characters")
    tokens = _tokenize(source)
    if not tokens:
        raise ExpressionError("the expression is empty")
    return _Parser(tokens, names).parse()


def join_arguments(arguments: list[str]) -> str:
    """One rule, however the shell split it.

    `shares complete (target - known) % modulus` without quotes arrives as several argv
    entries, and `*` may even have been globbed. Rejoining with spaces makes the unquoted
    form mean the same thing as the quoted one wherever the shell did not destroy it,
    which is one less way for a terminal session to go wrong.
    """
    return " ".join(argument.strip() for argument in arguments if argument.strip())
