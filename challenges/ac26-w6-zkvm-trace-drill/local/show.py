"""Participant Inspect evidence: only the public assignments, never expected values."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence


def main():
    print('この数をPythonに貼り、問題文の1行目へ進んでください。')
    print('Paste these values into Python, then continue from row 1.')
    print(public_evidence()['assignments'])
    print('m: 割る数 / divisor; limit: 上限 / limit; discounts: 足す数 / inputs')
    print('cases: 4つの入力例 / four cases; reports: その例についての報告 / reported claims')
    print('program: 確かめたいプログラム番号 / requested program number')
    print('other_program: 別のプログラム番号 / other program; other_limit: その上限 / its limit')


if __name__=='__main__':main()
