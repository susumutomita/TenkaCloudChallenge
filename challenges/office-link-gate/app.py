"""Sequential learning Challenge. One official flag only after every check."""
import base64
import hashlib
import hmac
import json
import os
from urllib.parse import parse_qs

WEB_HTML = ""
WEB_JS = ""
WEB_CSS = ""
CHECKS = ("completion",)


def text(lang, ja, en):
    return en if lang == "en" else ja


def secret(name):
    value = os.environ[name]
    if len(value) < 24:
        raise ValueError("Workshop secrets must contain at least 24 characters")
    return value


def token(stage):
    signature = hmac.new(secret("PROGRESS_KEY").encode(), f"office-link-gate:v1:{stage}".encode(), hashlib.sha256).hexdigest()
    return f"{stage}.{signature}"


def stage_of(receipt):
    if receipt == "":
        return 0
    if not isinstance(receipt, str):
        return None
    for stage in range(1, 5):
        if hmac.compare_digest(receipt.encode(), token(stage).encode()):
            return stage
    return None


def lesson(stage, lang):
    t = lambda ja, en: text(lang, ja, en)
    lessons = [
        {"title": t("同じ場所を見よう", "Look in the same place"),
         "concept": t("リージョンは、AWSの設備がある地域。東京と大阪は別の場所なので、同じ名前の資料でも置き場所を確かめます。", "An AWS region is a place where AWS runs its equipment. Tokyo and Osaka are different locations: check where an item lives, even if its name matches."),
         "example": t("例：横浜の受付で預かった荷物は、静岡の受付にはありません。まず場所をそろえます。", "Example: a parcel at reception in Yokohama is not at reception in Shizuoka. First agree on the location."),
         "question": t("仲間は『大阪で案内を保存した』と言っています。東京を探してもありません。最初に何をする？", "Your teammate saved the invitation in Osaka. You cannot find it in Tokyo. What do you do first?"),
         "options": [t("探す場所を大阪へそろえる", "Look in Osaka too"), t("案内の名前を変える", "Rename the invitation"), t("案内を削除する", "Delete the invitation")],
         "hints": [t("同じ名前でも、場所が違えば別のものです。", "The same name in another place can refer to something else."), t("例：棚Aの荷物を棚Bで探しても見つかりません。", "Example: an item on shelf A is not on shelf B."), t("仲間が保存した地域を読む → 自分が探している地域と比べる → 場所を合わせる選択肢を選ぶ。", "Read where your teammate saved it → compare where you searched → choose the action that aligns locations.")]},
        {"title": t("必要なことだけ許可しよう", "Allow only what is needed"),
         "concept": t("権限は『誰が、何に、何をしてよいか』の約束。AWSではIAMという仕組みで決めます。読む人へ、編集や他の資料の閲覧まで許可する必要はありません。", "A permission says who may do what to which resource. AWS IAM manages these rules. A reader does not necessarily need editing rights or access to other documents."),
         "example": t("例：来場者にメニューを見せても、店の売上表は見せません。", "Example: guests may read a menu without seeing the restaurant's sales records."),
         "question": t("来場者は案内を読むだけ。社内名簿は非公開です。どの権限にする？", "Visitors only need to read the invitation. The staff list is private. Which permission fits?"),
         "options": [t("全部の資料を編集できる", "Edit every document"), t("案内だけ読める", "Read only the invitation"), t("何も読めない", "Read nothing")],
         "hints": [t("困りごとの解消と、見せない資料の保護を両立します。", "Solve the access problem while protecting private documents."), t("例：メニューだけ読めれば、注文の相談ができます。", "Example: reading only the menu is enough to discuss an order."), t("必要な資料を読む → 必要な操作を読む → 両方だけを許可する選択肢を選ぶ。", "Find the needed document → find the needed action → allow only that combination.")]},
        {"title": t("控えの中身を確かめよう", "Check what a backup contains"),
         "concept": t("バックアップは、ある時刻の内容を保存した控え。復旧は、その控えから戻すことです。AWSのS3には過去版を残すバージョニングがあります。新しい控えでも、消えた後の内容なら元には戻りません。", "A backup is a copy saved at a particular time. Recovery restores a copy. AWS S3 versioning can retain older versions. The newest copy may already contain a deletion."),
         "example": t("例：9:10に内容を更新、9:20に削除。9:15の正常な控えなら更新後の内容を戻せます。", "Example: content was updated at 9:10 and deleted at 9:20. An intact 9:15 copy retains the update."),
         "question": t("12:10に会場を青へ変更。12:20に削除。12:05は赤、12:15は青、12:25は空です。どの控えを戻す？", "The venue changed to Blue at 12:10, then was deleted at 12:20. The 12:05 copy says Red, 12:15 says Blue, and 12:25 is empty. Which copy should you restore?"),
         "options": ["12:25", "12:05", "12:15"],
         "hints": [t("欲しいのは、消える前の一番新しい正常な内容です。", "You need the latest intact content from before deletion."), t("例：消えた後の控えに戻すと、空のままです。", "Example: restoring a copy made after deletion may restore an empty page."), t("削除時刻を読む → それより前の控えを比べる → 会場変更が入ったものを選ぶ。", "Read the deletion time → compare earlier copies → choose one containing the venue update.")]},
        {"title": t("直った証拠を仲間へ渡そう", "Hand over evidence that it works"),
         "concept": t("操作が成功した表示だけでなく、必要な結果が出たか確かめます。読む人2人・操作する人・確認する人の4人で相談し、次は担当を交代します。", "Check the required outcome, not only a successful operation message. Four teammates take two reader roles, one operator role and one checker role, then rotate."),
         "example": t("例：案内が読めても、会場が古ければ復旧完了ではありません。内容まで見ます。", "Example: a readable invitation with an old venue is not fully recovered. Check its contents."),
         "question": t("別の拠点へ復旧した案内を共有しました。完了前に、何を確かめて引き継ぐ？", "You shared a recovered invitation with another office. What should you check before handing over?"),
         "options": [t("成功メッセージだけを読む", "Only read the success message"), t("宛先・読める資料と操作・戻った内容を仲間と確認する", "Check the destination, allowed documents and actions, and restored contents together"), t("管理者権限を配って終了する", "Give everyone administrator access and finish")],
         "hints": [t("ここまでの3つの知識を、結果の確認に使います。", "Use the three concepts you learned to check the result."), t("例：案内は読めるが名簿も読めるなら、共有範囲が広すぎます。", "Example: if visitors can read the invitation and the staff list, sharing is too broad."), t("届け先を確認 → 必要な権限だけか確認 → 復旧した内容を確認 → この3つを含む引き継ぎを選ぶ。", "Check destination → check only needed access is allowed → check restored content → choose a handoff covering all three.")]},
    ]
    return lessons[stage]


def response(status, body, mime="application/json; charset=utf-8"):
    return {"statusCode": status, "headers": {"content-type": mime, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}, "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)}


def view(stage, lang):
    result = {"stage": stage, "total": 4, "done": stage == 4, "token": token(stage) if stage else ""}
    if stage == 4:
        result["flag"] = "TC{" + secret("FLAG_COMPLETION") + "}"
    else:
        result["lesson"] = lesson(stage, lang)
    return result


def handler(event, context=None):
    pieces = event.get("rawPath", "/").split("/", 2)
    if len(pieces) != 3 or not hmac.compare_digest(pieces[1].encode(), secret("PLAY_KEY").encode()):
        return response(404, {"error": "not_found"})
    route = pieces[2]
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    lang = "en" if parse_qs(event.get("rawQueryString", "")).get("lang") == ["en"] else "ja"
    if method == "GET":
        assets = {"": (WEB_HTML, "text/html"), "app.js": (WEB_JS, "text/javascript"), "style.css": (WEB_CSS, "text/css")}
        return response(200, assets[route][0], assets[route][1] + "; charset=utf-8") if route in assets else response(404, {"error": "not_found"})
    if method != "POST" or route not in ("api/state", "api/answer"):
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
    if not isinstance(data, dict):
        return response(400, {"error": "invalid_submission"})
    stage = stage_of(data.get("token", ""))
    if stage is None:
        return response(403, {"error": "invalid_progress"})
    if route == "api/state":
        return response(200, view(stage, lang))
    if stage == 4 or data.get("stage") != stage or type(data.get("stage")) is not int:
        return response(409, {"error": "wrong_stage"})
    if data.get("choice") != ("0", "1", "2", "1")[stage]:
        return response(200, {"correct": False, "message": text(lang, "もう一度、例と今回の場面を比べて相談しよう。減点はありません。", "Compare the example with this situation and discuss it again. No points are lost.")})
    return response(200, {"correct": True, **view(stage + 1, lang)})
