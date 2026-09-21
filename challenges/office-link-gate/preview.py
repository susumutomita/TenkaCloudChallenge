"""Loopback-only preview of the real Lambda handler; no platform or AWS scoring."""
import argparse
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import app

ROOT = Path(__file__).resolve().parent


class Preview(BaseHTTPRequestHandler):
    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def log_message(self, *_):
        pass  # Never print the capability URL, submitted receipts or flags in request logs.

    def dispatch(self):
        url = urlsplit(self.path)
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if size < 0:
            self.send_error(400)
            return
        if size > 8192:
            self.send_error(413)
            return
        result = app.handler({"rawPath": url.path, "rawQueryString": url.query, "requestContext": {"http": {"method": self.command}}, "body": self.rfile.read(size).decode("utf-8", errors="replace")})
        data = result["body"].encode()
        self.send_response(result["statusCode"])
        for key, value in result["headers"].items():
            self.send_header(key, value)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5685)
    parser.add_argument("--info-file", type=Path, help="Optional private preview URL file for browser harnesses")
    args = parser.parse_args()
    for key in ["PLAY_KEY", "PROGRESS_KEY"] + ["FLAG_" + check.upper().replace("-", "_") for check in app.CHECKS]:
        os.environ[key] = secrets.token_hex(24)
    app.WEB_HTML = (ROOT / "web.html").read_text()
    app.WEB_JS = (ROOT / "web.js").read_text()
    app.WEB_CSS = (ROOT / "web.css").read_text()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Preview)
    url = f"http://127.0.0.1:{server.server_port}/{os.environ['PLAY_KEY']}/"
    if args.info_file:
        descriptor = os.open(args.info_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump({"url": url}, stream)
    print("Local preview only; no official score: " + url, flush=True)
    server.serve_forever()
