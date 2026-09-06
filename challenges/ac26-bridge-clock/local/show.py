"""Participant Inspect: public practice values, with no expected answers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence


def main() -> None:
    print("== この問題の公開値 / Public values for this problem ==")
    print(public_evidence()["assignments"])
    print()
    print("n: 時計の目盛り数 / number of clock positions (0..n-1)")
    print("u, v: 余りを取る前の計算用の数 / arithmetic inputs")
    print("secret, cover: 前半の練習用原文と覆い / practice original and cover")
    print("seen1, seen2: 後半の別レコードの観測値2個 / observations in a separate record")
    print("known_first: 比較用の1通目の原文（最初から表示） / first original, visible for comparison")
    print("後半の実際の2通目と覆いは表示しません。前半のcoverとは別です。")
    print("The actual second original and cover of the later record are not displayed.")
    print("They do not use the earlier practice cover.")
    print("紙で計算できます。Pythonへコピーするのは任意です。")
    print("Calculate on paper, or optionally copy these assignments into Python.")


if __name__ == "__main__":
    main()
