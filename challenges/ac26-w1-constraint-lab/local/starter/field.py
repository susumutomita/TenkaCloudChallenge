"""
JA: 計算に使える標準ライブラリ（Python に付属する道具）は collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing。提出ファイル内で import できます。追加パッケージ、ファイルの読み書き、ネットワーク通信は使えません。提出コード全体の実行は15秒までです。
EN: Available computational standard libraries (tools included with Python): collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 15-second execution deadline.
One of three editor files / 編集する3ファイルの1つ。

A field here means remainders after division by a prime p, from 0 through p-1.
この問題では素数pで割った余り0〜p−1を使います。Pythonの value % p がその計算です。
Normalize means returning that remainder: 8 % 7 = 1, -1 % 7 = 6, 7 % 7 = 0.
正規化は結果をこの範囲へ直すこと。負の値も、大きい正の値も直します。
A residual is a condition's expression after substituting signal values and
normalizing. Zero means the condition holds / 残り0なら、その条件を満たします。
"""

from __future__ import annotations


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def normalize(self, value: int) -> int:
        """Return the remainder in 0 through modulus-1 / 割った余りを返す。

        The starter returns the input unchanged, including negatives and values >= p.
        """
        return value

    def add(self, a: int, b: int) -> int:
        return self.normalize(a + b)

    def sub(self, a: int, b: int) -> int:
        return self.normalize(a - b)

    def mul(self, a: int, b: int) -> int:
        return self.normalize(a * b)

    def is_zero(self, value: int) -> bool:
        return self.normalize(value) == 0
