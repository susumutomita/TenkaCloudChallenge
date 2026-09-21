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


class GateTest(unittest.TestCase):
    def setUp(self):
        self.env = {key: secrets.token_hex(24) for key in ["PLAY_KEY", "PROGRESS_KEY", "FLAG_COMPLETION"]}
        p = patch.dict(os.environ, self.env)
        p.start()
        self.addCleanup(p.stop)
        for name, file in [("WEB_HTML", "web.html"), ("WEB_JS", "web.js"), ("WEB_CSS", "web.css")]:
            setattr(app, name, (ROOT / file).read_text())

    def request(self, route, data=None, method="POST", lang="ja", key=None):
        return app.handler({"rawPath": "/" + (key or self.env["PLAY_KEY"]) + "/" + route, "rawQueryString": "lang=" + lang,
                            "requestContext": {"http": {"method": method}}, "body": json.dumps(data)})

    def test_one_official_flag_only_after_every_step(self):
        state = json.loads(self.request("api/state", {"token": ""})["body"])
        for stage, choice in enumerate(["0", "1", "2", "1"]):
            self.assertEqual(state["stage"], stage)
            self.assertNotIn("flag", state)
            self.assertNotIn("points", state)
            self.assertNotIn("lessons", state)
            wrong = json.loads(self.request("api/answer", {"token": state["token"], "stage": stage, "choice": "wrong"})["body"])
            self.assertFalse(wrong["correct"])
            self.assertNotIn("flag", wrong)
            payload = {"token": state["token"], "stage": stage, "choice": choice}
            state = json.loads(self.request("api/answer", payload)["body"])
            self.assertTrue(state["correct"])
            self.assertEqual(state, json.loads(self.request("api/answer", payload)["body"]))
            # Another device resumes at precisely the same next step.
            resumed = json.loads(self.request("api/state", {"token": state["token"]})["body"])
            self.assertEqual(resumed["stage"], stage + 1)
        self.assertTrue(state["done"])
        self.assertEqual(state["flag"], "TC{" + self.env["FLAG_COMPLETION"] + "}")
        self.assertNotIn("lesson", state)
        self.assertEqual(self.request("api/answer", {"token": state["token"], "stage": 4, "choice": "1"})["statusCode"], 409)

    def test_no_skipping_forging_cross_team_or_scoring_flag_as_progress(self):
        for stage in [1, 2, 3, True]:
            self.assertEqual(self.request("api/answer", {"stage": stage, "token": "", "choice": "1"})["statusCode"], 409)
        earned = json.loads(self.request("api/answer", {"stage": 0, "token": "", "choice": "0"})["body"])["token"]
        for invalid in [earned.replace("1.", "4."), "TC{" + self.env["FLAG_COMPLETION"] + "}", 4, None, "あ"]:
            self.assertEqual(self.request("api/state", {"token": invalid})["statusCode"], 403)
        with patch.dict(os.environ, {"PROGRESS_KEY": secrets.token_hex(24)}):
            self.assertEqual(self.request("api/state", {"token": earned})["statusCode"], 403)

    def test_private_assets_and_invalid_requests(self):
        for route in ["", "app.js", "style.css"]:
            result = self.request(route, method="GET")
            self.assertEqual(result["statusCode"], 200)
            for value in self.env.values():
                self.assertNotIn(value, result["body"])
            self.assertEqual(result["headers"]["referrer-policy"], "no-referrer")
            self.assertEqual(self.request(route, method="GET", key="あ")["statusCode"], 404)
        for value in [[], 1, "bad"]:
            self.assertEqual(self.request("api/state", value)["statusCode"], 400)
        event = {"rawPath": "/" + self.env["PLAY_KEY"] + "/api/state", "requestContext": {"http": {"method": "POST"}}, "body": "{", "isBase64Encoded": True}
        self.assertEqual(app.handler(event)["statusCode"], 400)
        event["body"] = base64.b64encode(b'{"token":""}').decode()
        self.assertEqual(app.handler(event)["statusCode"], 200)
        event["body"] = "x" * 8193
        self.assertEqual(app.handler(event)["statusCode"], 413)
        self.assertEqual(self.request("api/state", method="DELETE")["statusCode"], 405)

    def test_languages_and_deployed_artifact_match_the_tested_handler(self):
        for lang in ["ja", "en"]:
            self.assertEqual(json.loads(self.request("api/state", {"token": ""}, lang=lang)["body"])["total"], 4)
        template = build.template()
        namespace = {}
        exec(compile(template["Resources"]["Workshop"]["Properties"]["Code"]["ZipFile"], "index.py", "exec"), namespace)
        event = {"rawPath": "/" + self.env["PLAY_KEY"] + "/api/state", "requestContext": {"http": {"method": "POST"}}, "body": '{"token":""}'}
        self.assertEqual(namespace["handler"](event), app.handler(event))
        metadata = json.loads((ROOT / "metadata.json").read_text())
        self.assertEqual(metadata["scoring"], {"kind": "flag", "flagOutputKey": "CompletionFlag", "points": 100, "wrongAnswerPenalty": 5})
        self.assertEqual(template["Outputs"]["CompletionFlag"]["Value"], {"Fn::Sub": "TC{${CompletionSecret}}"})
        self.assertTrue(template["Parameters"]["ProgressKey"]["NoEcho"])
        self.assertNotIn("lambda:GetFunction", json.dumps(template["Resources"]["ParticipantViewerRole"]))
        self.assertEqual(template["Resources"]["WorkshopLogs"]["Properties"]["RetentionInDays"], 1)


if __name__ == "__main__":
    unittest.main()
