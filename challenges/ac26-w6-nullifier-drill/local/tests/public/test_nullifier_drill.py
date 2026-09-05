"""Check the public worked example, then print only the learner's own deployment outputs."""
from pathlib import Path
import os
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,os.environ.get('PARTICIPANT_STARTER_DIR', str(ROOT/'starter')))
import nullifier_drill as drill
from participant.exercise import ROW_ARGS,EXAMPLE,EXAMPLE_EXPECTED,call_row,valid_order,valid_schedule
from participant.evidence import public_evidence


def main():
    only=''
    if '--only' in sys.argv:
        position=sys.argv.index('--only')
        if position+1>=len(sys.argv):
            print('usage: --only <row name>')
            return 1
        only=sys.argv[position+1]
    rows=[row for row in ROW_ARGS if only in row]
    if not rows:
        print('No matching row; use '+', '.join(ROW_ARGS))
        return 1
    passed=True
    print('== one-digit model: p=7, secret=2, scope=1 ==')
    for row in rows:
        try:
            got=call_row(drill,row,EXAMPLE)
            if row in ('unchecked','collision'):
                same=(valid_order if row=='unchecked' else valid_schedule)(EXAMPLE,got)
                print(f'{"PASS" if same else "FAIL"} {row}: construction satisfies published conditions = {same}')
                passed &= same
                continue
            expected=EXAMPLE_EXPECTED[row]
            if isinstance(got, (list, tuple)) and isinstance(expected, (list, tuple)):
                same = len(got) == len(expected) and all(type(a) is type(b) and a == b for a, b in zip(got, expected))
            else:
                same = type(got) is type(expected) and got == expected
            print(f'{"PASS" if same else "FAIL"} {row}: got {got!r}, example {expected!r}')
            passed &= same
        except Exception as error:
            print(f'FAIL {row}: {type(error).__name__}: {error}')
            passed=False
    values=public_evidence()['public']
    print('== your values on this deployment: paste these into the answer fields ==')
    for row in rows:
        try:
            print(f'{row} -> {call_row(drill,row,values)!r}')
        except Exception as error:
            print(f'{row} -> ERROR {type(error).__name__}: {error}')
            passed=False
    print('public tests: '+('PASS' if passed else 'FAIL'))
    return 0 if passed else 1


if __name__=='__main__':raise SystemExit(main())
