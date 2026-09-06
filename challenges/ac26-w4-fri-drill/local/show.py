"""Inspect: the participant's numbers and their definitions, no expected values."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence


def main():
    payload=public_evidence()
    print('自分の数 / Your numbers (Python assignments)')
    print(payload['assignments'])
    print('p: 割る数 / divisor; all remainders lie between 0 and p-1')
    print('q0..q3: Q(X)=q0+q1*X+q2*X²+q3*X³ の係数 / coefficients')
    print('beta, beta2: 折るときに掛ける数 / fold multipliers')
    print('x: 0でない確認位置 / nonzero check position')
    print('d0,d1: すり替えで足す d0+d1*Y / alteration coefficients')
    print('この記録の条件 / Teaching conditions: Q1 is nonconstant;')
    print('the fixed alteration has two nonzero blind spots; x is chosen outside them.')
    print('これは終了後の算数用記録です / An arithmetic record, not a live FRI proof.')


if __name__=='__main__': main()
