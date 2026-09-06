"""oblivious.py の8関数を編集し、公開テスト→各小問の提出で確かめます。

OT（紛失通信）は送り手の2通から受け手が1通を選び、選択を送り手に隠し、
残りを受け手に渡さないための部品です。ここでは両役を同じ画面で計算します。
この小さい数では指数の総当たりが可能で、実際の秘密性は主張しません。

余りは % p、べき乗の余りは pow(g,t,p)。p=2q+1でp,qは素数。
gを繰り返し掛けるとq個で1に戻る集合を部分群、周期qを位数と呼びます。
gは生成元。grpのキーはp,q,g。送り手aは1..q-1、A=pow(g,a,p)。
受け手の乱数tがblind、選択ビットchoiceは0/1です。

必要な式（ここだけの ^ はPythonと同じXOR。べき乗はpow）:
  B = pow(g,t,p)                         choice0
  B = A * pow(g,t,p) % p                 choice1
  K0 = derive_key(grp,pow(B,a,p))
  K1 = derive_key(grp,pow(B*pow(A,p-2,p)%p,a,p))
  K  = derive_key(grp,pow(A,t,p))
  encrypt: (m0 ^ K0, m1 ^ K1)
  unwrap: ciphertexts[choice] ^ K
Aの逆元はAとの積の余りが1になる数。素数p、非零Aではpow(A,p-2,p)。

p7,q3,g2,a2ならA4、逆元2。t1なら:
  choice0 B2 -> 鍵の元4,2   choice1 B1 -> 鍵の元1,4
  受け手の鍵の元はどちらも4。選んだ側が一致する。
2進数は右から1,2,4の桁。011=0×4+1×2+1×1=3。
XORはその桁が同じなら0、違えば1。3(011)^5(101)=6(110)、6^5=3。
整数のXORは余りの足し算ではありません。derive_keyは配布済みの鍵変換です。

一様は候補が同確率、分布は観測値の確率。t=0,1,2を一様に選ぶと、
Bはchoice0で[1,2,4]、choice1で[4,1,2]。各値1/3で区別できません。
blind_rangeは連続するq整数の両端(low,high)。high-low+1=q。
0..q-1が一例。q..2q-1も一周期なので可。1..q-1では1個欠けます。
集合が同じだけでは足りません。[1,1,2]と[1,2,2]では1の確率が違います。

ビットは整数0/1。AND(&)は両方1なら1、XOR(^)は違うなら1。
秘密をXORで戻す持ち分がXORシェア: x=x0^x1、y=y0^y1。
ANDの展開は (x0&y0)^(x1&y1)^(x0&y1)^(x1&y0)。
相手と組になる最後の2交差項をOTで運ぶGMW方式の模型です。

マスクは値をXORで覆う乱数ビット。randomnessは独立一様な2個。
  m0,m1 = randomness[0],randomness[1]
  offer(u,m) = (m,m^u)                  -> 相手がvで選ぶとm^(u&v)
  1番が受信 v1 = offer(x0,m0)[y1]      0番が受信 v0 = offer(x1,m1)[y0]
  output_share(xi,yi,mi,vi) = (xi&yi)^mi^vi
例x0=1,x1=0,y0=y1=1,m0=0,m1=1: v0=v1=1、z0=z1=0、z0^z1=x&y=0。
同じマスクを使うとz0=(x0^x1)&y0。y0=1ならx1=z0^x0で漏れます。

gate-privacyの観測は(received,own output)だけ。自分の入力を固定し、
相手の入力を変え、乱数4通りの出現回数が同じか両側から比べます。
手順を守り観測から推測するsemi-honestモデルと正しいOTを前提とする模型で、
全通信・任意Pythonの実行の秘密性を証明するものではありません。

2個の戻り値はタプル (u,v) またはリスト [u,v]。各要素は整数。
ビットは整数0/1でbool不可。needs_transferだけbool: xorはFalse、andはTrue。
6欄すべてコード提出。unseenも同じ8関数を別の引数で動かします。
"""
from __future__ import annotations
from participant.ot import derive_key


def request(grp: dict[str, int], public: int, choice: int, blind: int) -> int:
    """上のBの式を適用。p7,g2,A4,t1ではchoice0→2、choice1→1。
    grpからp,g、publicからA、blindからtを取り、整数の余りを返す。"""
    return 1


def blind_range(grp: dict[str, int]) -> tuple[int, int] | list[int]:
    """同確率で選ぶ連続q個の両端。p7,q3では(0,2)や(3,5)が一周期。
    下の範囲は1個欠ける。幅と、要求の値ごとの出現回数を確かめる。"""
    return (1, grp['q'] - 1)


def encrypt(grp: dict[str, int], secret: int, public: int, req: int,
            message_0: int, message_1: int) -> tuple[int, int] | list[int]:
    """K0=H(B^a)、K1=H((B/A)^a)を作り、それぞれのメッセージとXOR。
    ここで^は数学のべき乗。コードはpow。B/Aを作った後もsecret乗が必要。"""
    return (message_0, message_1)


def unwrap(grp: dict[str, int], public: int, choice: int, blind: int,
           ciphertexts: tuple[int, int] | list[int]) -> int:
    """H(pow(public,blind,p))を、選んだciphertexts[choice]とXORする。
    p7,A4,t1ならH(4)。数学の鍵の一致と実用の秘密性は別の条件。"""
    return 0


def gate_masks(randomness: tuple[int, int]) -> tuple[int, int] | list[int]:
    """供給された独立一様な2ビットを別々のマスクに使う。
    (0,1)を(0,0)にすると復元は合っても手元でマスクが消えてしまう。"""
    return (randomness[0], randomness[0])


def offer(own_bit: int, mask: int) -> tuple[int, int] | list[int]:
    """(mask,mask^own_bit)。own_bit1,mask0なら(0,1)。
    相手の選択ビットvに応じ、mask^(own_bit&v)が渡る。"""
    return (0, 0)


def output_share(own_x: int, own_y: int, own_mask: int, received: int) -> int:
    """(own_x&own_y)^own_mask^receivedを返す。1,1,0,1なら0。
    自分の積、自分のマスク、受信値を1回ずつ入れ、両者でマスクを打ち消す。"""
    return 0


def needs_transfer(gate: str) -> bool:
    """引数はxor/andのみ。XORシェアのxorは手元だけ(False)、andは通信(True)。"""
    return True
