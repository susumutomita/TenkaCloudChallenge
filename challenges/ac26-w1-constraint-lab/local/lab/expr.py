"""A one-line constraint language, because the terminal sends one line at a time.

A gadget is submitted as the polynomial that must come out zero:

    tier*(tier - 1)             ->  the residual `tier * (tier - 1)`
    (tier - 3)*(tier - 40)      ->  the residual `(tier - 3) * (tier - 40)`
    tier*tier = tier            ->  the same as `tier*tier - tier`; `=` is subtraction

Grammar, smallest thing that can express a constraint:

    equation := sum ( '=' sum )?
    sum      := product ( ('+' | '-') product )*
    product  := unary ( '*' unary )*
    unary    := ('-' | '+')* atom
    atom     := integer | signal | '(' sum ')'

No division: a constraint system has no division either. A constraint is an
expression that must be zero over the whole witness, and division is not one of
the operations available for writing it.

The same language is used by `ac26-w1-underconstraint`, deliberately: a learner
who wrote a gadget here submits a repair there with the same syntax.
"""

from __future__ import annotations

from typing import Callable

#: Bounds, so a pasted line cannot turn into a pathological parse. Generous enough
#: that no honest constraint comes close.
MAX_SOURCE_LENGTH = 400
MAX_DEPTH = 24


class ExpressionError(ValueError):
    """A parse or name error, phrased for the participant rather than for a stack trace."""


def _tokenize(source: str) -> list[str]:
    tokens: list[str] = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char in "+-*()=":
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
                "division is not available: a circuit cannot divide, which is why the "
                "inverse is a signal the prover supplies"
            )
        raise ExpressionError(f"unexpected character {char!r}")
    return tokens


class _Parser:
    def __init__(self, tokens: list[str], signals: tuple[str, ...]) -> None:
        self.tokens = tokens
        self.signals = signals
        self.position = 0

    def peek(self) -> str | None:
        return self.tokens[self.position] if self.position < len(self.tokens) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise ExpressionError("the expression ends earlier than it should")
        self.position += 1
        return token

    def equation(self) -> Callable[[dict[str, int], int], int]:
        left = self.sum(0)
        if self.peek() == "=":
            self.take()
            right = self.sum(0)
            if self.peek() is not None:
                raise ExpressionError(f"unexpected {self.peek()!r} after the expression")
            return lambda witness, p: left(witness, p) - right(witness, p)
        if self.peek() is not None:
            raise ExpressionError(f"unexpected {self.peek()!r} after the expression")
        return left

    def sum(self, depth: int) -> Callable[[dict[str, int], int], int]:
        node = self.product(depth)
        while self.peek() in ("+", "-"):
            operator = self.take()
            right = self.product(depth)
            left = node
            if operator == "+":
                node = lambda w, p, a=left, b=right: a(w, p) + b(w, p)
            else:
                node = lambda w, p, a=left, b=right: a(w, p) - b(w, p)
        return node

    def product(self, depth: int) -> Callable[[dict[str, int], int], int]:
        node = self.unary(depth)
        while self.peek() == "*":
            self.take()
            right = self.unary(depth)
            left = node
            node = lambda w, p, a=left, b=right: a(w, p) * b(w, p)
        return node

    def unary(self, depth: int) -> Callable[[dict[str, int], int], int]:
        if self.peek() == "-":
            self.take()
            inner = self.unary(depth)
            return lambda w, p, a=inner: -a(w, p)
        if self.peek() == "+":
            self.take()
            return self.unary(depth)
        return self.atom(depth)

    def atom(self, depth: int) -> Callable[[dict[str, int], int], int]:
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
            return lambda _w, _p, v=value: v
        if token in self.signals:
            return lambda w, _p, name=token: w[name]
        if token in (")", "*", "+", "-", "="):
            raise ExpressionError(f"{token!r} is not something a value can start with")
        raise ExpressionError(
            f"unknown name {token!r}; the signals are " + ", ".join(self.signals)
        )


def compile_expression(source: str, signals: tuple[str, ...]) -> Callable[[dict[str, int], int], int]:
    """Compile one residual expression. Raises ExpressionError with a readable reason."""
    if len(source) > MAX_SOURCE_LENGTH:
        raise ExpressionError(f"the expression is longer than {MAX_SOURCE_LENGTH} characters")
    tokens = _tokenize(source)
    if not tokens:
        raise ExpressionError("the expression is empty")
    return _Parser(tokens, signals).equation()


def split_expressions(arguments: list[str]) -> list[str]:
    """One argument may carry several constraints, separated by ';' or ','.

    The terminal sends a single line, and a shell eats unquoted spaces, so
    `repair "a*b; c*d"` has to mean the same thing as two quoted arguments.
    """
    pieces: list[str] = []
    for argument in arguments:
        for piece in argument.replace(";", ",").split(","):
            if piece.strip():
                pieces.append(piece.strip())
    return pieces
