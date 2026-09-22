"""Public lab page and bounded, non-secret network observations on EC2."""
import json
import os
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LAB = os.environ["LAB_NAME"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/check":
            try:
                with urllib.request.urlopen("https://checkip.amazonaws.com/", timeout=3) as result:
                    outbound = result.read(128).decode().strip()
            except (OSError, ValueError):
                # This is the observation being taught, not a successful check.
                outbound = None
            body = json.dumps({"lab": LAB, "outboundIp": outbound,
                "sessionCommandRan": os.path.isfile("/tmp/office-link-visited"),
                "sessionCommandAt": os.stat("/tmp/office-link-visited").st_mtime if os.path.isfile("/tmp/office-link-visited") else None}).encode()
            mime = "application/json"
        elif self.path == "/":
            body = ("<!doctype html><html lang=en><meta charset=utf-8><title>Office Link</title>"
                "<style>body{font:22px system-ui;max-width:45rem;margin:12vh auto;padding:2rem;background:#122940;color:white}"
                "strong{color:#72e2b2}</style><h1>Office Link</h1><p><strong>Connected / つながりました！</strong></p>"
                f"<p>{LAB}</p><p>Ask a teammate to check this page. / 仲間にも開いてもらおう。</p></html>").encode()
            mime = "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    observation = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    threading.Thread(target=observation.serve_forever, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 80), Handler).serve_forever()
