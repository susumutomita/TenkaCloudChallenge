"""Problem-owned workshop handler; AWS Lambda and the local preview use this code."""
import base64
import hashlib
import hmac
import json
import os
from urllib.parse import parse_qs

WEB_HTML = ""  # Embedded by build.py; injected from disk by preview.py.
WEB_JS = ""
WEB_CSS = ""
CHECKS = ("delivery", "delivery-why", "sharing", "sharing-why", "restore", "restore-why")
POINTS = (15, 15, 20, 15, 20, 15)


def text(lang, ja, en):
    return en if lang == "en" else ja


def secret(name):
    value = os.environ[name]
    if len(value) < 24:
        raise ValueError("Workshop secrets must contain at least 24 characters")
    return value


def flag(check):
    return "TC{" + secret("FLAG_" + check.upper().replace("-", "_")) + "}"


def scenario(lang):
    """Only clues and available actions leave the server; no verdict keys or flags."""
    t = lambda ja, en: text(lang, ja, en)
    variant = hashlib.sha256(secret("FLAG_DELIVERY").encode()).digest()[0] % 3
    codes = ("A7", "B4", "C2")
    sites = [t("海辺の拠点", "Seaside office"), t("森の拠点", "Forest office"), t("丘の拠点", "Hill office")]
    destinations = [{"id": str(i), "label": sites[i]} for i in range(3)]
    return {"missions": [
        {
            "id": "delivery", "icon": "↗", "title": t("招待状を届けよう", "Deliver the invitation"),
            "goal": t("別の拠点にいる仲間へ、交流会の招待状を届ける。", "Get an invitation to colleagues at another office."),
            "before": t("招待状は、宛先が分からず止まっています。", "The invitation is waiting for a destination."),
            "cards": [
                {"role": t("依頼を読む人", "Request reader"), "title": t("受付からのメモ", "Reception note"), "body": t(f"招待先の拠点コードは {codes[variant]}。同じコードの宛先へ届けてください。", f"The receiving office code is {codes[variant]}. Deliver to the office with that code.")},
                {"role": t("地図を読む人", "Map reader"), "title": t("配送先マップ", "Delivery map"), "body": " · ".join(sites[i] + " = " + codes[i] for i in range(3))},
            ],
            "fields": [{"id": "destination", "label": t("招待状の宛先", "Invitation destination"), "options": destinations}],
            "button": t("この宛先へ届ける", "Deliver here"),
            "hints": [t("呼び名が違っても、同じ拠点コードなら同じ宛先です。", "Different names can refer to the same office code."), t("例えば D8 宛てなら、地図で D8 と書かれた拠点を探します。", "For example, for code D8, find the office marked D8 on the map."), t("受付メモのコードを声に出す → 地図で同じコードを探す → その拠点を選んで届けます。", "Read out the reception code → find the same code on the map → select that office and deliver.")],
            "lesson": t("届いた！宛先をそろえると、相手まで届きます。AWSにも東京や大阪などの『リージョン＝設備のある地域』があります。同じ名前の設定でも、地域が違えば別物です。", "Delivered! Matching the destination gets the message to its recipient. AWS has regions, such as Tokyo and Osaka: places where its equipment runs. The same setting name in two regions refers to different things."),
            "why": t("次の相談：同じ名前の設定が見つかりません。仲間は大阪、自分は東京を見ています。最初に何をそろえる？", "Next request: you cannot find a setting by name. Your colleague is looking in Osaka and you are looking in Tokyo. What should you align first?"),
            "reasons": [
                {"id": "0", "label": t("設定の名前を全部変える", "Rename every setting")},
                {"id": "1", "label": t("見ている地域をそろえる", "Look in the same region")},
                {"id": "2", "label": t("同じ設定を何個も作る", "Create several copies")},
            ],
            "whyHint": t("設定の名前より先に、探している場所が同じか確かめます。", "Before changing the name, check whether you are looking in the same place."),
        },
        {
            "id": "sharing", "icon": "▣", "title": t("案内だけを共有しよう", "Share just the invitation"),
            "goal": t("来場者に案内を見せる。社内名簿は見せない。", "Let visitors read the invitation. Keep the staff list private."),
            "before": t("来場者はまだ案内を読めません。", "Visitors cannot read the invitation yet."),
            "cards": [
                {"role": t("依頼を読む人", "Request reader"), "title": t("受付からのお願い", "Reception request"), "body": t("来場者には案内を読むだけの権限が必要。書き換える必要はありません。", "Visitors need permission to read the invitation. They do not need to edit it.")},
                {"role": t("資料を確認する人", "Document keeper"), "title": t("共有してよいもの", "Sharing boundary"), "body": t("『案内』は配ってよい。『社内名簿』は社外へ出せない。権限とは、誰が何をしてよいかの約束です。", "The invitation may be distributed. The staff list must stay internal. A permission is a rule about who may do what.")},
            ],
            "fields": [
                {"id": "scope", "label": t("来場者に見せる資料", "Documents visitors may see"), "options": [{"id": "0", "label": t("案内だけ", "Invitation only")}, {"id": "1", "label": t("案内と社内名簿", "Invitation and staff list")}, {"id": "2", "label": t("何も見せない", "Nothing")}]},
                {"id": "permission", "label": t("許可する操作", "Allowed action"), "options": [{"id": "0", "label": t("読む・書き換える", "Read and edit")}, {"id": "1", "label": t("読むだけ", "Read only")}]},
            ],
            "button": t("共有して、見え方を確かめる", "Share and check visibility"),
            "hints": [t("開けない問題は、全部公開すればよいとは限りません。必要な人に必要な資料だけを渡します。", "Fixing access does not mean making everything public. Share only what the recipient needs."), t("例：メニューを見せたいだけなら、来店者に売上表の編集まで許可しません。", "Example: showing guests a menu does not require letting them edit sales records."), t("受付の『読むだけ』と、資料係の『配ってよいもの』を聞く → 2つの選択欄を合わせる → 来場者の見え方を確認します。", "Ask reception which action is needed and the keeper which document may be shared → set both controls → check the visitor's view.")],
            "lesson": t("案内は読める、名簿は読めない、書き換えもできない。これが『必要な権限だけを渡す』です。AWSのIAMも、誰がどの資源で何をしてよいかを決める仕組みです。", "Visitors can read the invitation, cannot read the staff list, and cannot edit. That is giving only the permissions needed. AWS IAM defines who may do what to which resource."),
            "why": t("次の相談：請求書を読む担当へ権限を渡します。確認する組み合わせは？", "Next request: grant an invoice reader access. Which pair of checks should you run?"),
            "reasons": [{"id": "0", "label": t("管理者権限があることだけ", "Only check administrator access")}, {"id": "1", "label": t("請求書は読める ＋ 給与表は読めない", "Invoices are readable + payroll is not")}, {"id": "2", "label": t("全部の資料が読めない", "No document can be read")}],
            "whyHint": t("必要な操作ができることと、不要な操作ができないことを両方確認します。", "Check both that the needed action works and that unnecessary access is blocked."),
        },
        {
            "id": "restore", "icon": "↶", "title": t("消えた案内を取り戻そう", "Recover the missing invitation"),
            "goal": t("消える直前までの案内を取り戻して、仲間に確認してもらう。", "Recover the latest intact invitation and ask a teammate to check it."),
            "before": t("案内が消えて、来場者が迷っています。", "The invitation is missing and visitors cannot find the venue."),
            "cards": [
                {"role": t("記録を読む人", "Timeline reader"), "title": t("何が起きた？", "What happened?"), "body": t("10:00 初版を公開。10:10 会場を『青いホール』へ変更。10:20 誤操作で案内を消した。", "10:00 first edition published. 10:10 venue changed to Blue Hall. 10:20 invitation accidentally deleted.")},
                {"role": t("控えを持つ人", "Backup keeper"), "title": t("残っている控え", "Saved copies"), "body": t("10:05 赤いホール / 10:15 青いホール / 10:25 案内なし。バックアップとは、戻すために残した控えです。", "10:05 Red Hall / 10:15 Blue Hall / 10:25 no invitation. A backup is a saved copy you can recover from.")},
            ],
            "fields": [{"id": "backup", "label": t("どの控えへ戻す？", "Which copy should you restore?"), "options": [{"id": "0", "label": "10:05"}, {"id": "1", "label": "10:15"}, {"id": "2", "label": "10:25"}] }],
            "button": t("この控えから復旧する", "Recover from this copy"),
            "hints": [t("新しい控えでも、消えた後の状態を保存していたら復旧できません。", "A newer backup may already contain the deletion."), t("例：9:30 に消えたなら、9:40 よりも、消える前の正常な控えが必要です。", "Example: after a 9:30 deletion, a 9:40 copy may be too late. You need a healthy copy from before deletion."), t("記録係に消えた時刻を聞く → その前で一番新しい控えを選ぶ → 戻った会場名を記録と照らします。", "Ask when deletion happened → pick the latest intact copy before that → compare the restored venue with the timeline.")],
            "lesson": t("青いホールの案内が戻りました。控えから戻せるのは、保存した時点の内容です。AWSのS3には、同じファイルの過去版を残す『バージョニング』という機能があります。", "The Blue Hall invitation is back. A saved copy contains the information from when it was made. AWS S3 offers versioning to retain earlier versions of a file."),
            "why": t("次の相談：予約表を11:00の控えへ戻したら、画面は開くのに11:10に追加した予約が消えた。11:15の控えもある。次に何を確かめる？", "Next request: restoring an 11:00 copy makes the booking page open, but a booking added at 11:10 is missing. An 11:15 copy also exists. What should you check next?"),
            "reasons": [{"id": "0", "label": t("画面が開くので、このまま完了にする", "The page opens, so declare recovery complete")}, {"id": "1", "label": t("11:15の控えを別の場所へ戻し、追加予約が残っているか比べる", "Restore the 11:15 copy separately and compare the added booking")}, {"id": "2", "label": t("11:10以降の予約をすべて削除する", "Delete every booking added after 11:10")}],
            "whyHint": t("画面が開くことと、必要な予約が残ることは別です。追加された時刻と、控えの時刻を比べます。", "A working page may still be missing bookings. Compare when the booking was added with when each copy was saved."),
        },
    ]}


def evaluate(check, values, lang):
    t = lambda ja, en: text(lang, ja, en)
    variant = str(hashlib.sha256(secret("FLAG_DELIVERY").encode()).digest()[0] % 3)
    if check.endswith("-why"):
        predecessor = check.removesuffix("-why")
        receipt = values.get("receipt")
        if not isinstance(receipt, str) or not hmac.compare_digest(receipt.encode(), flag(predecessor).encode()):
            return False, t("先にこのミッションを直して、同じ端末で解説ミッションへ進んでください。", "Complete this mission's repair first, then continue to its explanation on the same device.")
        expected = {"delivery-why": "1", "sharing-why": "1", "restore-why": "1"}[check]
        return values.get("reason") == expected, t("直った理由のカードと、次の相談をもう一度見比べましょう。", "Compare the repair lesson with the next request once more.")
    if check == "delivery":
        return values.get("destination") == variant, t("まだ届きません。受付の拠点コードと、配送先マップを見比べてください。", "Not delivered yet. Compare the reception code with the delivery map.")
    if check == "sharing":
        ok = values.get("scope") == "0" and values.get("permission") == "1"
        if values.get("scope") == "1":
            return False, t("案内は読めますが、社内名簿まで見えています。共有範囲を見直そう。", "The invitation is readable, but the staff list is visible too. Reconsider the scope.")
        return ok, t("受付の必要な操作と、共有してよい資料の両方を確かめよう。", "Check both the action reception needs and which document may be shared.")
    return values.get("backup") == "1", t("必要な案内へ戻っていません。消えた時刻と、会場変更の記録を見比べよう。", "The needed invitation is not restored. Compare the deletion time with the venue change.")


def response(status, body, mime="application/json; charset=utf-8"):
    return {"statusCode": status, "headers": {
        "content-type": mime, "cache-control": "no-store", "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    }, "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)}


def handler(event, context=None):
    path = event.get("rawPath", "/")
    # Each team receives its own random capability URL. It is not a login key
    # for the platform and never authorizes score changes or AWS account access.
    pieces = path.split("/", 2)
    access = secret("PLAY_KEY")
    if len(pieces) != 3 or not hmac.compare_digest(pieces[1].encode(), access.encode()):
        return response(404, {"error": "not_found"})
    route = pieces[2]
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    query = parse_qs(event.get("rawQueryString", ""))
    lang = "en" if query.get("lang") == ["en"] else "ja"
    if method == "GET":
        if route == "":
            return response(200, WEB_HTML, "text/html; charset=utf-8")
        if route == "app.js":
            return response(200, WEB_JS, "text/javascript; charset=utf-8")
        if route == "style.css":
            return response(200, WEB_CSS, "text/css; charset=utf-8")
        if route == "api/scenario":
            return response(200, scenario(lang))
        return response(404, {"error": "not_found"})
    if method != "POST" or route not in ("api/play", "api/handoff"):
        return response(405, {"error": "method_not_allowed"})
    body = event.get("body") or ""
    if len(body) > 8192:
        return response(413, {"error": "too_large"})
    try:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body, validate=True).decode("utf-8")
        data = json.loads(body)
    except (ValueError, UnicodeError):
        return response(400, {"error": "invalid_json"})
    if not isinstance(data, dict) or not isinstance(data.get("values"), dict):
        return response(400, {"error": "invalid_submission"})
    check = data.get("checkpoint")
    if not isinstance(check, str) or check not in CHECKS:
        return response(400, {"error": "unknown_checkpoint"})
    if route == "api/handoff":
        receipt = data["values"].get("receipt")
        ok = not check.endswith("-why") and isinstance(receipt, str) and hmac.compare_digest(receipt.encode(), flag(check).encode())
        message = text(lang, "このチーム・このミッションの操作の合言葉を確認してください。", "Check the repair passphrase for this team and this mission.")
    else:
        ok, message = evaluate(check, data["values"], lang)
    if not ok:
        return response(200, {"correct": False, "message": message})
    return response(200, {"correct": True, "checkpoint": check, "flag": flag(check), "points": POINTS[CHECKS.index(check)]})
