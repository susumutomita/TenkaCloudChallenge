"""編集するファイルは linear.py。秘密を集めず、各人のシェアで計算する模型です。

シェア share は秘密の持ち分。全部足すと秘密xに戻ります。
  x = sum(a) % p, y = sum(b) % p
各人iは自分の a[i], b[i] だけを使います。エディタは学習用に全員を一覧に
しているので、一覧を集めればxも求まります。ここで画面の秘密性は主張しません。

pは奇数の素数、nは2以上。余りを `% p` で0..p-1に直します。
乱数で適切に作られた加法的シェアだけから始め、追加の事前配布データはありません。

必要な式（Σは全員ぶん足す記号）:
  add_shares:    out[i] = (a[i] + b[i]) % p        合計x+y
  mul_constant:  out[i] = (a[i] * c) % p           合計cx
  add_constant:  out[0] = (a[0] + c) % p           合計x+c
                 out[i] = a[i] % p (i>0)
定数足し算の一般形は、合計がcになる公開調整値d[i]を各人に足すこと。
[c,0,...,0]は簡単な一例で、唯一の方法ではありません。

p=7, a=[5,6,0], b=[1,0,2], c=2:
  足す     [6,6,2] -> 合計14 -> 余り0 = (4+3)%7
  全員2倍  [3,5,0] -> 合計8  -> 余り1 = (4*2)%7
  0番+2    [0,6,0] -> 合計6  -> 余り6 = (4+2)%7
  全員+2   [0,1,2] -> 合計3  -> 目標6と違う

communication_rounds は必要性の分類で、厳密なラウンド数ではありません。
  0: add-shared, sub-shared, negate-shared, add-constant, mul-constant
  1以上: mul-shared, square-shared, compare-shared
比較は復元した0..p-1の整数同士の比較。入力名はこの8種類です。
二乗は奇数pでは交差項2*a0*a1が残り、手元の二乗だけでは足りません。

直接回答 no-communication は「証拠を確認」の4名だけをキーにするJSON。
例の4名が表示された場合のみ:
  {"add-shared":0,"sub-shared":0,"mul-shared":1,"square-shared":1}
回答欄へ1行で入力します。コードの4小問はエディタの現在のソースを提出。
提出前に「公開テストを実行」で合計の例を確認します。"""

from __future__ import annotations


def add_shares(a: list[int], b: list[int], p: int) -> list[int]:
    """同じ人の2つの持ち分を足し、x+yのシェアを返す。

    out[i]=(a[i]+b[i])%p。合計の並べ替えでΣout=Σa+Σb。
    入力a,bは同じ人数・順序。zipで同じ位置を組にし、同じ長さの整数リストを返す。
    p=7, a=[5,6,0], b=[1,0,2] -> [6,6,2] -> 合計の余り0。"""
    return list(a)


def add_constant(shares: list[int], c: int, p: int) -> list[int]:
    """全員が知っているcを、秘密xへ一度加えたx+cのシェアを返す。

    入力をコピーし、0番だけ (shares[0]+c)%p、他は shares[i]%p にする。
    一般には、合計の余りがcとなる公開調整値d[i]を加えてよい。
    p=7, shares=[5,6,0], c=2 -> [0,6,0]、合計6。
    全員にcを足すと差は(n-1)c。c=0など差の余り0なら偶然一致するが、
    別の値でも成立する方法が必要。合計・長さ・正規化を検査する。"""
    return [(s + c) % p for s in shares]


def mul_constant(shares: list[int], c: int, p: int) -> list[int]:
    """全員が知っているcで、各人の持ち分を倍率変更する。

    out[i]=(shares[i]*c)%p。分配法則でΣout=c*Σshares。
    p=7, shares=[5,6,0], c=2 -> [3,5,0]、合計の余り1。
    全員ぶんを同じ長さの整数リストにする。"""
    return list(shares)


def communication_rounds(operation: str) -> int:
    """8種類の操作を、手元で完結なら0、通信が必要なら正の整数で返す。

    分類と条件はこのファイル冒頭。相手との積の項があると、手元の行だけでは
    処理できない。1は正確な往復回数の保証ではない。負数・boolは不可。
    transferは8名すべてを使い、直接回答欄は画面で選ばれた4名だけを使う。"""
    return 1
