"""Loopback UI preview with explicitly labelled AWS fixtures; never deploys."""
import argparse
import json
import os
import runpy
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

FAMILY = Path(__file__).resolve().parent


def serve(problem, port=5685, info_file=None, fixture_file=None):
    builder = runpy.run_path(str(FAMILY / "build.py"))
    app = {}
    exec(compile(builder["compile_code"](problem), "index.py", "exec"), app)
    for key in ["PLAY_KEY", "PROGRESS_KEY", "FLAG_COMPLETION"]:
        os.environ[key] = secrets.token_hex(24)
    os.environ["LAB_CONFIG"] = json.dumps(dict(region="ap-northeast-1", namePrefix="tc-preview-team1", serverName="tc-preview-team1-server",
        publicIp="192.0.2.10", vpcId="vpc-preview", subnetId="subnet-preview", networkInterfaceId="eni-preview", launchTemplateId="lt-preview",
        instanceType="t3.micro", imageId="ami-preview", routeTableId="rtb-preview", instanceProfileName="tc-preview-team1-session",
        tableName="tc-preview-team1-handover", queueName="tc-preview-team1-handover", instanceId="i-preview", alarmName="tc-preview-team1-cpu",
        functionName="tc-preview-team1-receiver", studentLogGroup="/aws/lambda/tc-preview-team1-receiver",
        testEvent=json.dumps({'team':'tc-preview-team1','parcels':3}),
        bucketName="tc-preview-team1-bucket", objectKey="handover.txt", fileContent="Office link: meeting room A\n", securityGroupId="sg-preview", httpSourceCidr="0.0.0.0/0"))

    class PreviewChecks:
        def __init__(self, _config): pass
        def run(self, kind, inputs=None):
            if not fixture_file:
                raise app["NotReady"]("Preview has no AWS connection. Supply an explicit fixture file for UI tests.")
            state = json.loads(fixture_file.read_text()).get(kind, {})
            if state.get("error"):
                raise RuntimeError("Fixture AWS error")
            if state.get("ready") is not True:
                raise app["NotReady"]("Fixture: this AWS step is not ready yet.")
            return {"fixtureCheck": kind}
    app["AwsChecks"] = PreviewChecks
    original_view = app["view"]
    def preview_view(stage, language):
        result = original_view(stage, language)
        result["mode"] = "preview"
        return result
    app["view"] = preview_view

    class Preview(BaseHTTPRequestHandler):
        def do_GET(self): self.dispatch()
        def do_POST(self): self.dispatch()
        def log_message(self, *_): pass  # Never log capability URLs or flags.
        def dispatch(self):
            url = urlsplit(self.path)
            try: size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_error(400); return
            if size < 0 or size > 8192:
                self.send_error(413); return
            result = app["handler"]({"rawPath": url.path, "rawQueryString": url.query,
                "requestContext": {"http": {"method": self.command}}, "body": self.rfile.read(size).decode("utf-8", errors="replace")})
            data = result["body"].encode()
            self.send_response(result["statusCode"])
            for key, value in result["headers"].items(): self.send_header(key, value)
            self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)
    server = ThreadingHTTPServer(("127.0.0.1", port), Preview)
    url = f"http://127.0.0.1:{server.server_port}/{os.environ['PLAY_KEY']}/"
    if info_file:
        descriptor = os.open(info_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as stream: json.dump({"url": url}, stream)
    print("UI preview only; no AWS operation or official scoring: " + url, flush=True)
    server.serve_forever()


def main(problem):
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5685)
    parser.add_argument("--info-file", type=Path)
    parser.add_argument("--fixture-file", type=Path, help="Explicit local AWS observation fixtures for UI tests")
    args = parser.parse_args()
    serve(problem, args.port, args.info_file, args.fixture_file)
