"""Inspect prints public inputs and the fixture's explicitly selected teaching conditions."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence
v=public_evidence()
print('自分の数 / Your numbers (Python assignments)')
print(v['assignments'])
print('p: すべての計算で割る数 / divisor for ALL gate, address and fingerprint arithmetic')
print('a0,b0: 足し算の入力 / addition inputs; g: 次の行の左入力を変える数 / left-input shift')
print('k0,k1,k2: 左・右・出力の列の番地 / column tags; w: 2行目の番地の倍率 / second-row multiplier')
print('beta,gamma: 値と番地に混ぜる数 / fingerprint mixing numbers')
print('この記録は一つの入力変更を検出し、両入力を変える非ゼロ積の反例が作れるように選んであります。')
print('Selected teaching record: detects the displayed alteration; a nonzero-product counterexample exists.')
print('全ての値が見える算数模型です / Visible arithmetic model, not a PLONK proof.')
