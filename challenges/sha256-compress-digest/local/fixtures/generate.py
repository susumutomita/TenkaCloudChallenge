"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing here ships a committed constant a learner could memorize. Same seed, same
fixtures (so a session is reproducible and debuggable); different seed, different
fixtures (so an answer copied from someone else's run does not carry).

The two quiz checkpoints deserve a note. Their statements are fixed — there is no way to
generate a good true/false claim about hash functions from a seed — so what the seed
varies is the ORDER. The submitted answer is a string of T and F in that order, which
means the string itself is worthless to anyone with a different deployment, while the
statements stay ones a person can actually reason about.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

MASK = 0xFFFFFFFF
STATE_WORDS = 8
SCHEDULE_WORDS = 64
DIGEST_BITS = 256


@dataclass(frozen=True)
class RoundCase:
    """One round's inputs: a state, a round index, and that round's schedule word."""

    state: tuple[int, ...]
    round_index: int
    schedule_word: int


@dataclass(frozen=True)
class AvalancheCase:
    """Two messages one bit apart."""

    message: bytes
    bit: int

    @property
    def flipped(self) -> bytes:
        data = bytearray(self.message)
        data[self.bit // 8] ^= 1 << (self.bit % 8)
        return bytes(data)


@dataclass(frozen=True)
class Statement:
    """One quiz claim, and whether it is true."""

    text: str
    text_ja: str
    true: bool


#: The `properties` checkpoint. Every one of these is a claim somebody has actually made
#: about SHA-256, and every false one is false for a reason a learner can name.
PROPERTY_STATEMENTS: tuple[Statement, ...] = (
    Statement(
        "SHA-256 is not encryption, so there is nothing to decrypt it back with.",
        "SHA-256 は暗号化ではないので、復号するための鍵も手順も存在しない。",
        True,
    ),
    Statement(
        "Because the output is 256 bits and inputs can be any length, collisions must exist.",
        "出力が 256 bit で入力の長さが無制限なので、衝突は必ず存在する。",
        True,
    ),
    Statement(
        "No collision has ever been published for SHA-256, so collisions do not exist.",
        "SHA-256 の衝突は publish されていないので、衝突は存在しない。",
        False,
    ),
    Statement(
        "The digest is always 256 bits, whether the input is empty or a gigabyte.",
        "digest は入力が空でも 1 GB でも常に 256 bit になる。",
        True,
    ),
    Statement(
        "A longer input produces a longer digest.",
        "入力が長ければ digest も長くなる。",
        False,
    ),
    Statement(
        "Changing one input bit changes roughly half the output bits.",
        "入力を 1 bit 変えると、出力のおよそ半分の bit が変わる。",
        True,
    ),
    Statement(
        "Changing one input bit changes roughly one output bit.",
        "入力を 1 bit 変えると、出力も 1 bit 前後しか変わらない。",
        False,
    ),
    Statement(
        "The same input always produces the same digest, on any machine.",
        "同じ入力なら、どのマシンでも常に同じ digest になる。",
        True,
    ),
    Statement(
        "A digest reveals how long the input was.",
        "digest を見れば元の入力が何バイトだったか分かる。",
        False,
    ),
    Statement(
        "Being able to find any two colliding inputs is a weaker demand than "
        "finding a second input colliding with a given one.",
        "任意の衝突ペアを見つけることは、与えられた入力に衝突する別の入力を見つけることより弱い要求である。",
        True,
    ),
)

#: The `storage` checkpoint. Password storage, which is where a fast hash does damage.
STORAGE_STATEMENTS: tuple[Statement, ...] = (
    Statement(
        "Storing SHA256(password) is fine as long as the database is not leaked.",
        "データベースが漏れなければ SHA256(password) をそのまま保存してよい。",
        False,
    ),
    Statement(
        "Adding a salt to SHA-256 makes it a suitable password hash.",
        "SHA-256 にソルトを付ければパスワードハッシュとして十分になる。",
        False,
    ),
    Statement(
        "SHA-256 being fast is a disadvantage for password storage.",
        "SHA-256 が速いことは、パスワード保存では欠点になる。",
        True,
    ),
    Statement(
        "A salt stops precomputed rainbow tables but not a GPU brute-force.",
        "ソルトはレインボーテーブルを無効化するが、GPU による総当たりは止めない。",
        True,
    ),
    Statement(
        "Use a deliberately slow, cost-tunable function: Argon2, bcrypt, scrypt or PBKDF2.",
        "意図的に遅くコストを調整できる関数 (Argon2 / bcrypt / scrypt / PBKDF2) を使う。",
        True,
    ),
    Statement(
        "Every password should get its own distinct salt.",
        "ソルトはパスワードごとに別のものを使う。",
        True,
    ),
    Statement(
        "One salt shared across the whole table is enough, since it is still random.",
        "ソルトはランダムであれば、テーブル全体で 1 つを共有すれば十分。",
        False,
    ),
    Statement(
        "Argon2id resists GPUs and ASICs partly by requiring memory, not just time.",
        "Argon2id は時間だけでなくメモリも要求することで、GPU や ASIC の優位を削る。",
        True,
    ),
    Statement(
        "Iterating SHA-256 a few thousand times is exactly what PBKDF2 does, "
        "so hand-rolling that loop is equivalent to using PBKDF2.",
        "SHA-256 を数千回繰り返すのが PBKDF2 なのだから、自分でその loop を書けば PBKDF2 と等価である。",
        False,
    ),
    Statement(
        "A pepper (an application-side secret) removes the need for per-user salts.",
        "ペッパー (アプリ側の秘密) があれば、ユーザーごとのソルトは不要になる。",
        False,
    ),
)


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _word(stream: list[int], index: int) -> int:
    base = (index * 4) % (len(stream) - 4)
    return int.from_bytes(bytes(stream[base : base + 4]), "big")


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


def _shuffled(items: tuple[Statement, ...], seed: str, label: str) -> list[Statement]:
    """A deterministic permutation. Fisher-Yates driven by the stream."""
    s = _stream(seed, label)
    order = list(items)
    for index in range(len(order) - 1, 0, -1):
        swap = _pick(s, (index * 2) % 400, 0, index)
        order[index], order[swap] = order[swap], order[index]
    return order


def round_case(seed: str) -> RoundCase:
    """The `round` checkpoint's single visible case."""
    s = _stream(seed, "round")
    return RoundCase(
        state=tuple(_word(s, position) for position in range(STATE_WORDS)),
        round_index=_pick(s, 200, 0, SCHEDULE_WORDS - 1),
        schedule_word=_word(s, 20),
    )


def hidden_rounds(seed: str) -> list[RoundCase]:
    """Round cases the public tests never use, including the degenerate states."""
    s = _stream(seed, "hidden-rounds")
    cases = [
        RoundCase(state=tuple(0 for _ in range(STATE_WORDS)), round_index=0, schedule_word=0),
        RoundCase(state=tuple(MASK for _ in range(STATE_WORDS)), round_index=63, schedule_word=MASK),
        RoundCase(
            state=tuple(0 if position % 2 else MASK for position in range(STATE_WORDS)),
            round_index=17,
            schedule_word=0x80000000,
        ),
    ]
    for case_index in range(9):
        cases.append(
            RoundCase(
                state=tuple(
                    _word(s, case_index * STATE_WORDS + position) for position in range(STATE_WORDS)
                ),
                round_index=_pick(s, (case_index * 4) % 400, 0, SCHEDULE_WORDS - 1),
                schedule_word=_word(s, 100 + case_index),
            )
        )
    return cases


def hidden_states(seed: str) -> list[tuple[int, ...]]:
    """Incoming states for the block-level checks."""
    s = _stream(seed, "states")
    return [
        tuple(0 for _ in range(STATE_WORDS)),
        tuple(MASK for _ in range(STATE_WORDS)),
        *(
            tuple(_word(s, case * STATE_WORDS + position) for position in range(STATE_WORDS))
            for case in range(4)
        ),
    ]


def hidden_schedules(seed: str) -> list[list[int]]:
    """64-word schedules for the block-level checks. Not real message schedules, on
    purpose: `compress_block` must not care where its words came from."""
    s = _stream(seed, "schedules")
    return [
        [0] * SCHEDULE_WORDS,
        [MASK] * SCHEDULE_WORDS,
        [_word(s, position) for position in range(SCHEDULE_WORDS)],
        [_word(s, position + 70) for position in range(SCHEDULE_WORDS)],
    ]


def hidden_messages(seed: str) -> list[bytes]:
    """Messages for the digest check.

    The lengths are chosen around the block boundary, and several of them cross it, because
    "compresses only the first block" is the shipped starter's defect and short messages
    would not catch it.
    """
    s = _stream(seed, "messages")
    lengths = [0, 1, 55, 56, 63, 64, 65, 119, 120, 191, 192, _pick(s, 0, 200, 400)]
    messages = [bytes(s[position % len(s)] for position in range(length)) for length in lengths]
    messages.append(b"abc")
    messages.append("天下雲の下で符号を数える".encode())
    return messages


def avalanche_case(seed: str) -> AvalancheCase:
    """The `avalanche` checkpoint: a message, and one bit of it to flip."""
    s = _stream(seed, "avalanche")
    length = _pick(s, 0, 6, 24)
    message = bytes(s[(position + 40) % len(s)] for position in range(length))
    return AvalancheCase(message=message, bit=_pick(s, 4, 0, length * 8 - 1))


def inversion_case(seed: str) -> tuple[tuple[int, ...], list[int]]:
    """The `feedforward` checkpoint's visible case: a state and a schedule."""
    s = _stream(seed, "inversion")
    state = tuple(_word(s, position) for position in range(STATE_WORDS))
    schedule = [_word(s, position + 30) for position in range(SCHEDULE_WORDS)]
    return state, schedule


def property_quiz(seed: str) -> list[Statement]:
    """The `properties` statements, in this deployment's order."""
    return _shuffled(PROPERTY_STATEMENTS, seed, "properties")


def storage_quiz(seed: str) -> list[Statement]:
    """The `storage` statements, in this deployment's order."""
    return _shuffled(STORAGE_STATEMENTS, seed, "storage")


def quiz_answer(statements: list[Statement]) -> str:
    """The expected T/F string for a quiz in a given order."""
    return "".join("T" if statement.true else "F" for statement in statements)


def health_token(seed: str) -> str:
    """Proof the learner actually started the container rather than reading the README."""
    case = round_case(seed)
    return hashlib.sha256(f"health:{seed}:{case.state[0]:08x}".encode()).hexdigest()[:16]
