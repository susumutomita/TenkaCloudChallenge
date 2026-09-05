"""Complete the visible rows; the tiny model provides no cryptographic anonymity.
For rows 1-7 copy the whole matching block and return its final expression.
For row 8 construct a collision yourself; no completed implementation is supplied.
"""

def label(p, secret, scope):
    """同じ人が同じ投票で使う印を計算します。この模型では「秘密の数を二乗して投票番号を足し、pで割った余り」です。
    Calculate the marker for this person and election. In this toy model, square the secret, add the election number, then keep the remainder by p.
    """
    return None


def repeat(p, secret, scope, messages):
    """messagesは二回の投票内容です。各回の印を並べます。内容が変わっても同じ人の二票目を見分けたいので、式にmessageを入れません。
    messages contains two votes. List their markers. The formula excludes message so a changed vote cannot disguise this person’s second submission.
    """
    return None


def scopes(p, secret, scope_ids):
    """scope_idsは別々の投票番号です。同じ人でも、別の投票には参加できます。番号を式に含めて二つの印を比べます。
    scope_ids contains two different election numbers. The same person may participate in each. Include the election number and compare the markers.
    """
    return None


def accept(scope, attempts):
    """attemptsは届いた六件です。verifiedは確認済みか、scopeは投票番号、nullifierは印。確認済み・今回の番号・印が未使用の三条件を満たすときだけ受理し、印を記録します。
    attempts contains six requests. verified is prechecked status, scope the election number, and nullifier the marker. Accept and record a marker only when verification passed, the election matches, and the marker is unused.
    """
    return None


def count(scope, attempts):
    """受理した印の個数を確かめます。届いた件数や、確認済みの件数ではありません。lenはリストの個数です。
    Count recorded markers after processing the requests. This is not the number received or merely verified. len counts list entries.
    """
    return None


def message(p, secret, scope, messages):
    """誤った式として、印へmessageも足す人がいます。その式で二回の投票を処理し、未使用の印なら受理すると何が起きるか調べます。ここは意図的に誤った方式の結果を答えます。
    An incorrect design adds message to the marker formula. Process two votes under that design, accepting unused markers. Here report the behavior of the deliberately incorrect design.
    """
    return None


def unchecked(scope, attempts):
    """確認済みかを見ず、「今回の番号で、印が未使用なら受理」とする方式を試します。その方式で受理したうち、未確認だった依頼をTrueにします。
    Try a design that skips verified status and accepts any unused marker in this election. Mark True for requests it accepts despite being unverified.
    """
    return None


def collision(p, secret, scope):
    """0〜p−1のうちsecretと違う数で、同じ印になる最小の数を探します。違う入力から同じ印が出ることを衝突と呼びます。この模型では必ず一つ見つかります。
    Among 0 through p−1, find the smallest number different from secret that produces the same marker. Different inputs producing the same output are a collision. This model always provides one.
    """
    return None
