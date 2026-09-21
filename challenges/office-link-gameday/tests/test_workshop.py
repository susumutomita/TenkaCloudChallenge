import base64
import json
import os
import secrets
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app
import build


class WorkshopTest(unittest.TestCase):
    def setUp(self):
        self.env = {key: secrets.token_hex(24) for key in ["PLAY_KEY"] + ["FLAG_" + c.upper().replace("-", "_") for c in app.CHECKS]}
        self.patcher = patch.dict(os.environ, self.env)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        app.WEB_HTML = (ROOT / "web.html").read_text()
        app.WEB_JS = (ROOT / "web.js").read_text()
        app.WEB_CSS = (ROOT / "web.css").read_text()

    def request(self, route="api/play", method="POST", data=None, lang="ja", key=None):
        return app.handler({"rawPath": "/" + (key or self.env["PLAY_KEY"]) + "/" + route,
                            "rawQueryString": "lang=" + lang,
                            "requestContext": {"http": {"method": method}},
                            "body": json.dumps(data) if data is not None else ""})

    def play(self, check, values, lang="ja"):
        result = self.request(data={"checkpoint": check, "values": values}, lang=lang)
        self.assertEqual(result["statusCode"], 200)
        return json.loads(result["body"])

    def inputs(self):
        # Infer the first destination from the same public clue cards, not a flag.
        mission = json.loads(self.request("api/scenario", "GET")["body"])["missions"][0]
        card = mission["cards"][0]["body"]
        destination = next(o["id"] for o in mission["fields"][0]["options"] if o["detail"] in card)
        return {"delivery": {"destination": destination}, "sharing": {"scope": "invitation", "permission": "read"}, "restore": {"backup": "good"}}

    def test_six_independent_checkpoints_and_retry(self):
        metadata = json.loads((ROOT / "metadata.json").read_text())
        self.assertEqual(sum(f["points"] for f in metadata["scoring"]["flags"]), 100)
        self.assertEqual([f["id"] for f in metadata["scoring"]["flags"]], list(app.CHECKS))
        self.assertEqual([f["points"] for f in metadata["scoring"]["flags"]], list(app.POINTS))
        self.assertTrue(all(f["wrongAnswerPenalty"] == 5 for f in metadata["scoring"]["flags"]))
        reasons = {"delivery": "region", "sharing": "both", "restore": "rehearse"}
        earned = []
        for check, values in self.inputs().items():
            wrong = self.play(check, {})
            self.assertFalse(wrong["correct"])
            self.assertNotIn("flag", wrong)
            result = self.play(check, values)
            self.assertTrue(result["correct"])
            self.assertEqual(result, self.play(check, values))
            self.assertEqual(result["flag"], app.flag(check))
            earned.append(result["flag"])
            why = check + "-why"
            for receipt in ["", "あ", app.flag("restore-why")]:
                self.assertFalse(self.play(why, {"reason": reasons[check], "receipt": receipt})["correct"])
            self.assertFalse(self.play(why, {"reason": "wrong", "receipt": result["flag"]})["correct"])
            explanation = self.play(why, {"reason": reasons[check], "receipt": result["flag"]})
            self.assertTrue(explanation["correct"])
            earned.append(explanation["flag"])
        self.assertEqual(len(set(earned)), 6)

    def test_no_answer_or_capability_in_initial_assets(self):
        for route in ["", "app.js", "style.css", "api/scenario"]:
            result = self.request(route, "GET")
            self.assertEqual(result["statusCode"], 200)
            for secret in self.env.values():
                self.assertNotIn(secret, result["body"])
            self.assertEqual(result["headers"]["cache-control"], "no-store")
            self.assertEqual(result["headers"]["referrer-policy"], "no-referrer")
        for key in ["wrong-key", "あいうえお"]:
            for route in ["", "api/scenario", "app.js", "style.css"]:
                self.assertEqual(self.request(route, "GET", key=key)["statusCode"], 404)

    def test_receipt_cannot_unlock_another_team(self):
        receipt = self.play("delivery", self.inputs()["delivery"])["flag"]
        with patch.dict(os.environ, {"FLAG_DELIVERY": secrets.token_hex(24)}):
            self.assertFalse(self.play("delivery-why", {"receipt": receipt, "reason": "region"})["correct"])

    def test_invalid_inputs_fail_without_secret_leaks(self):
        for data in [[], 5, "hello", {}, {"checkpoint": [], "values": {}}, {"checkpoint": "missing", "values": {}}, {"checkpoint": "delivery", "values": []}]:
            result = self.request(data=data)
            self.assertEqual(result["statusCode"], 400)
            self.assertNotIn("TC{", result["body"])
        self.assertEqual(self.request("api/play", "GET")["statusCode"], 404)
        self.assertEqual(self.request("api/play", "DELETE")["statusCode"], 405)
        event = {"rawPath": "/" + self.env["PLAY_KEY"] + "/api/play", "requestContext": {"http": {"method": "POST"}}, "body": "{"}
        self.assertEqual(app.handler(event)["statusCode"], 400)
        event["body"] = "x" * 8193
        self.assertEqual(app.handler(event)["statusCode"], 413)
        event.update({"body": "not base64", "isBase64Encoded": True})
        self.assertEqual(app.handler(event)["statusCode"], 400)
        event["body"] = base64.b64encode(json.dumps({"checkpoint": "delivery", "values": self.inputs()["delivery"]}).encode()).decode()
        self.assertTrue(json.loads(app.handler(event)["body"])["correct"])

    def test_english_and_japanese_share_verdicts(self):
        en = json.loads(self.request("api/scenario", "GET", lang="en")["body"])
        ja = json.loads(self.request("api/scenario", "GET", lang="ja")["body"])
        self.assertEqual([m["id"] for m in en["missions"]], [m["id"] for m in ja["missions"]])
        self.assertEqual(en["missions"][0]["title"], "Deliver the invitation")
        for check, values in self.inputs().items():
            self.assertEqual(self.play(check, values, "en"), self.play(check, values, "ja"))

    def test_deployed_code_is_the_same_handler_and_has_no_cloud_write_permissions(self):
        template = build.template()
        # Platform names combine two slugs of up to 40 characters. Let CFN
        # choose the Lambda name so long valid team names do not exceed 64.
        longest_prefix = "tc-" + "p" * 40 + "-" + "t" * 40
        self.assertGreaterEqual(template["Parameters"]["NamePrefix"]["MaxLength"], len(longest_prefix))
        function = template["Resources"]["Workshop"]["Properties"]
        self.assertNotIn("FunctionName", function)
        self.assertEqual(function["LoggingConfig"]["LogGroup"], {"Ref": "WorkshopLogs"})
        code = template["Resources"]["Workshop"]["Properties"]["Code"]["ZipFile"]
        namespace = {}
        exec(compile(code, "index.py", "exec"), namespace)
        event = {"rawPath": "/" + self.env["PLAY_KEY"] + "/api/scenario", "requestContext": {"http": {"method": "GET"}}}
        self.assertEqual(namespace["handler"](event), app.handler(event))
        role = template["Resources"]["WorkshopRole"]["Properties"]
        actions = role["Policies"][0]["PolicyDocument"]["Statement"][0]["Action"]
        self.assertEqual(actions, ["logs:CreateLogStream", "logs:PutLogEvents"])
        self.assertNotIn("*", json.dumps(role["Policies"]))
        self.assertEqual(template["Resources"]["WorkshopLogs"]["Properties"]["RetentionInDays"], 1)
        self.assertTrue(template["Resources"]["UrlInvocation"]["Properties"]["InvokedViaFunctionUrl"])
        self.assertIn("sts:ExternalId", json.dumps(template["Resources"]["ParticipantViewerRole"]))
        self.assertNotIn("lambda:GetFunction", json.dumps(template["Resources"]["ParticipantViewerRole"]))
        metadata = json.loads((ROOT / "metadata.json").read_text())
        for entry, name in zip(metadata["scoring"]["flags"], build.NAMES):
            self.assertEqual(template["Outputs"][entry["flagOutputKey"]]["Value"], {"Fn::Sub": "TC{${" + name + "Secret}}"})
        for key in metadata["cfnParameters"]:
            self.assertTrue(template["Parameters"][key]["NoEcho"])


if __name__ == "__main__":
    unittest.main()
