"""Full AWS-operation/explanation sequence and deployment parity (AWS fixtures)."""
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
        self.env["LAB_CONFIG"] = json.dumps({"region":"ap-northeast-1", "namePrefix":"tc-lab-team1", "hidden":"not-public"})
        p = patch.dict(os.environ, self.env); p.start(); self.addCleanup(p.stop)
        self.check = patch.object(app.AwsChecks, "run", return_value={"state":"verified"}).start()
        self.addCleanup(patch.stopall)

    def request(self, route, data=None, method="POST", lang="ja", key=None):
        return app.handler({"rawPath": "/" + (key or self.env["PLAY_KEY"]) + "/" + route, "rawQueryString": "lang=" + lang,
                            "requestContext": {"http": {"method": method}}, "body": json.dumps(data)})

    def state(self, token=""):
        return json.loads(self.request("api/state", {"token":token})["body"])

    def test_one_official_flag_only_after_five_aws_checks_and_explanations(self):
        state = self.state()
        for stage in range(10):
            self.assertEqual(state["stage"], stage)
            self.assertNotIn("flag", state)
            self.assertNotIn("points", state)
            self.assertNotIn("correctChoice", json.dumps(state))
            self.assertNotIn("not-public", json.dumps(state))
            self.assertEqual(state["phase"], "explain" if stage % 2 else "operate")
            if stage % 2:
                wrong = json.loads(self.request("api/check", {"token":state["token"], "stage":stage, "choice":"wrong"})["body"])
                self.assertFalse(wrong["correct"])
                self.assertNotIn("flag", wrong)
            choice = str(app.CURRICULUM["missions"][stage//2]["correctChoice"])
            payload = {"token": state["token"], "stage": stage, "choice":choice}
            state = json.loads(self.request("api/check", payload)["body"])
            self.assertTrue(state["correct"])
            # Retrying after a lost reply and handing over both preserve the sequence.
            self.assertEqual(state, json.loads(self.request("api/check", payload)["body"]))
            self.assertEqual(self.state(state["token"])["stage"], stage + 1)
        self.assertTrue(state["done"])
        self.assertEqual(state["flag"], "TC{" + self.env["FLAG_COMPLETION"] + "}")
        self.assertNotIn("mission", state)
        self.assertEqual(self.request("api/check", {"token":state["token"], "stage":10})["statusCode"], 409)
        self.assertEqual([c.args[0] for c in self.check.call_args_list], [kind for kind in ['launch','gateway','route','session','http'] for _ in range(2)])

    def test_answer_alone_cannot_replace_aws_operation(self):
        self.check.side_effect = app.NotReady("The EC2 instance is not running")
        result = json.loads(self.request("api/check", {"stage":0, "token":"", "choice":"1"})["body"])
        self.assertFalse(result["correct"])
        self.assertNotIn("token", result)
        self.assertEqual(self.state()["stage"], 0)
        self.check.side_effect = RuntimeError("AWS failure with private details")
        error = self.request("api/check", {"stage":0, "token":""})
        self.assertEqual(error["statusCode"], 503)
        self.assertNotIn("private details", error["body"])
        self.assertNotIn("correct", json.loads(error["body"]))

    def test_no_skipping_forging_cross_team_or_scoring_flag_as_progress(self):
        for stage in [1, 4, 9, True]:
            self.assertEqual(self.request("api/check", {"stage":stage, "token":"", "choice":"1"})["statusCode"], 409)
        earned = json.loads(self.request("api/check", {"stage":0, "token":""})["body"])["token"]
        for invalid in [earned.replace("1.", "10."), "TC{"+self.env["FLAG_COMPLETION"]+"}", 4, None, "あ"]:
            self.assertEqual(self.request("api/state", {"token":invalid})["statusCode"], 403)
        with patch.dict(os.environ, {"PROGRESS_KEY":secrets.token_hex(24)}):
            self.assertEqual(self.request("api/state", {"token":earned})["statusCode"], 403)
        with patch.dict(app.CURRICULUM, {"id":"another-problem"}):
            self.assertEqual(self.request("api/state", {"token":earned})["statusCode"], 403)

    def test_private_assets_and_invalid_requests(self):
        for route in ["", "app.js", "style.css"]:
            result = self.request(route, method="GET")
            self.assertEqual(result["statusCode"], 200)
            for value in self.env.values(): self.assertNotIn(value, result["body"])
            self.assertEqual(result["headers"]["referrer-policy"], "no-referrer")
            self.assertEqual(self.request(route, method="GET", key="あ")["statusCode"], 404)
        for value in [[], 1, "bad"]:
            self.assertEqual(self.request("api/state", value)["statusCode"], 400)
        event = {"rawPath":"/"+self.env["PLAY_KEY"]+"/api/state", "requestContext":{"http":{"method":"POST"}}, "body":"{", "isBase64Encoded":True}
        self.assertEqual(app.handler(event)["statusCode"], 400)
        event["body"] = base64.b64encode(b'{"token":""}').decode()
        self.assertEqual(app.handler(event)["statusCode"], 200)
        event["body"] = "x" * 8193
        self.assertEqual(app.handler(event)["statusCode"], 413)
        self.assertEqual(self.request("api/state", method="DELETE")["statusCode"], 405)

    def test_languages_and_deployed_artifact_match_the_tested_handler(self):
        for lang in ["ja", "en"]:
            state = json.loads(self.request("api/state", {"token":""}, lang=lang)["body"])
            self.assertEqual(state["total"], 5)
            self.assertIsInstance(state["mission"]["steps"], list)
            self.assertNotIn("correctChoice", json.dumps(state))
        template = build.template()
        namespace = {}
        exec(compile(template["Resources"]["Workshop"]["Properties"]["Code"]["ZipFile"], "index.py", "exec"), namespace)
        event = {"rawPath":"/"+self.env["PLAY_KEY"]+"/api/state", "requestContext":{"http":{"method":"POST"}}, "body":'{"token":""}'}
        self.assertEqual(namespace["handler"](event), app.handler(event))
        metadata = json.loads((ROOT/"metadata.json").read_text())
        self.assertEqual(metadata["scoring"], {"kind":"flag", "flagOutputKey":"CompletionFlag", "points":100, "wrongAnswerPenalty":5})
        self.assertEqual(template["Outputs"]["CompletionFlag"]["Value"], {"Fn::Sub":"TC{${CompletionSecret}}"})
        self.assertTrue(template["Parameters"]["ProgressKey"]["NoEcho"])
        self.assertNotIn("lambda:GetFunction", json.dumps(template["Resources"]["ParticipantViewerRole"]))
        self.assertEqual(template["Resources"]["WorkshopLogs"]["Properties"]["RetentionInDays"], 1)


if __name__ == "__main__": unittest.main()
