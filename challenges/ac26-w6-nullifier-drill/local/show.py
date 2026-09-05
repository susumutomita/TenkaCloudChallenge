"""Only public, paste-ready inputs for this deployment."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence


def main():
    print('p = から attempts = までの代入文をPythonへ貼り、1行目の印を計算します。')
    print('Paste assignment lines from p = through attempts = into Python, then calculate row 1.')
    print(public_evidence()['assignments'])
    print('p: 割る数 / divisor; secret: 見学用の秘密の数 / observer secret; scope: 今回の投票番号 / requested election')
    print('scope_ids: 二つの投票番号 / two elections; messages: 二つの投票内容 / two votes')
    print('attempts: 表示順に届いた6件 / six requests in order')
    print('verified: 確認済みか / prechecked status; nullifier: 使用済み判定の印 / spent marker')


if __name__=='__main__':main()
