"""Signed, sequential progress around real AWS checks; no early scoring flag."""
import base64
import hashlib
import hmac
import json
import os
from urllib.parse import parse_qs

from checks import AwsChecks, NotReady

WEB_HTML = ""
WEB_JS = ""
WEB_CSS = ""
CURRICULUM = {}
OBSERVATIONS = {}


def choose(value, language):
    return value[language] if isinstance(value, dict) and "ja" in value and "en" in value else value


def localized(value, language):
    if isinstance(value, list):
        return [localized(item, language) for item in value]
    if isinstance(value, dict):
        if "ja" in value and "en" in value:
            return value[language]
        return {key: localized(item, language) for key, item in value.items() if key != "correctChoice"}
    return value


def secret(name):
    value = os.environ[name]
    if len(value) < 24:
        raise ValueError("Workshop secrets must contain at least 24 characters")
    return value


def signature(stage):
    payload = f"aws-intro:v1:{CURRICULUM['id']}:{stage}".encode()
    return hmac.new(secret("PROGRESS_KEY").encode(), payload, hashlib.sha256).hexdigest()


def receipt(stage):
    return f"{stage}.{signature(stage)}" if stage else ""


def read_receipt(value):
    if value == "":
        return 0
    if not isinstance(value, str) or len(value) > 100:
        return None
    for stage in range(1, 2 * len(CURRICULUM["missions"]) + 1):
        if hmac.compare_digest(value.encode(), receipt(stage).encode()):
            return stage
    return None


def response(status, data, mime="application/json; charset=utf-8"):
    return {"statusCode": status, "headers": {
        "content-type": mime, "cache-control": "no-store", "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    }, "body": data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)}


def configuration():
    return json.loads(os.environ["LAB_CONFIG"])


def view(stage, language):
    count = len(CURRICULUM["missions"])
    done = stage == count * 2
    data = {"stage": stage, "total": count, "done": done, "token": receipt(stage),
        "title": choose(CURRICULUM["title"], language), "mode": "aws", "problemId": CURRICULUM["id"],
        "steps": [choose(m["title"], language) for m in CURRICULUM["missions"]]}
    if done:
        data["flag"] = "TC{" + secret("FLAG_COMPLETION") + "}"
    else:
        mission = CURRICULUM["missions"][stage // 2]
        data["mission"] = localized(mission, language)
        data["phase"] = "explain" if stage % 2 else "operate"
        config = configuration()
        # Only explicitly public resource hints cross the boundary. Never
        # spread environment variables, flags, or arbitrary configuration.
        public_keys = {"tableName", "queueName", "alarmName", "instanceId", "functionName", "studentLogGroup", "testEvent", "bucketName", "objectKey", "fileContent", "namePrefix", "region", "vpcId", "subnetId", "networkInterfaceId", "routeTableId",
            "serverName", "publicIp", "securityGroupId", "instanceProfileName", "instanceType", "imageId", "launchTemplateId", "httpSourceCidr"}
        data["resources"] = {key: value for key, value in config.items() if key in public_keys}
    return data


def handler(event, context=None):
    parts = event.get("rawPath", "").split("/", 2)
    if len(parts) != 3 or not hmac.compare_digest(parts[1].encode(), secret("PLAY_KEY").encode()):
        return response(404, {"error": "not_found"})
    route = parts[2]
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    language = "en" if parse_qs(event.get("rawQueryString", "")).get("lang") == ["en"] else "ja"
    if method == "GET":
        if route == "starter.txt" and CURRICULUM.get("labKind") == "s3-save":
            result = response(200, configuration()["fileContent"], "text/plain; charset=utf-8")
            result["headers"]["content-disposition"] = 'attachment; filename="handover.txt"'
            return result
        assets = {"": (WEB_HTML, "text/html"), "app.js": (WEB_JS, "text/javascript"), "style.css": (WEB_CSS, "text/css")}
        return response(200, assets[route][0], assets[route][1] + "; charset=utf-8") if route in assets else response(404, {"error": "not_found"})
    if method != "POST" or route not in ("api/state", "api/check"):
        return response(405, {"error": "method_not_allowed"})
    raw = event.get("body") or ""
    if len(raw) > 8192:
        return response(413, {"error": "too_large"})
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        return response(400, {"error": "invalid_json"})
    if not isinstance(data, dict):
        return response(400, {"error": "invalid_submission"})
    stage = read_receipt(data.get("token", ""))
    if stage is None:
        return response(403, {"error": "invalid_progress"})
    if route == "api/state":
        return response(200, view(stage, language))
    if type(data.get("stage")) is not int or data["stage"] != stage or stage == 2 * len(CURRICULUM["missions"]):
        return response(409, {"error": "wrong_stage"})
    mission = CURRICULUM["missions"][stage // 2]
    if stage % 2:
        if data.get("choice") != str(mission["correctChoice"]):
            return response(200, {"correct": False, "message": choose({"ja": "構成図と、操作した前後の違いを仲間と見比べよう。", "en": "Compare the diagram and the before/after change together."}, language)})
        evidence = {}
    else:
        try:
            inputs = data.get("inputs", {})
            if not isinstance(inputs, dict) or any(not isinstance(value, str) or len(value) > 256 for value in inputs.values()):
                return response(400, {"error": "invalid_inputs"})
            checker = AwsChecks(configuration())
            evidence = checker.run(mission["check"], inputs) if mission.get("inputs") else checker.run(mission["check"])
        except NotReady as error:
            return response(200, {"correct": False, "message": choose({"ja": "まだ確認できません。AWSの観測結果を手掛かりに、手順を確かめてください。", "en": "Not ready yet. Use the AWS observation to check your steps."}, language), "observation": OBSERVATIONS.get(str(error), str(error)) if language == "ja" else str(error)})
        except Exception as error:
            # Do not turn AccessDenied, timeouts, or malformed AWS replies into
            # an incorrect answer. This is an operational error; keep progress.
            code = getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__)
            return response(503, {"error": "aws_check_failed", "code": code})
    return response(200, {"correct": True, "evidence": evidence, **view(stage + 1, language)})
