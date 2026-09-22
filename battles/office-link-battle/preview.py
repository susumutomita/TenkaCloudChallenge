"""Loopback-only UI harness. Explicit fixtures replace AWS; no cloud credentials used."""
import argparse
import copy
import json
import os
import runpy
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5686)
    parser.add_argument('--info-file', type=Path)
    parser.add_argument('--fixture-file', type=Path, help='Explicit JSON: round, healthy, restore')
    args = parser.parse_args()
    app = {}
    exec(compile(runpy.run_path(str(ROOT/'build.py'))['compile_code'](), 'index.py', 'exec'), app)
    os.environ['PLAY_KEY'] = secrets.token_hex(24)
    os.environ['COOPERATION_SECRET'] = secrets.token_hex(32)
    lock = threading.RLock()

    class Store:
        state = {'revision': 0, 'index': 0, 'phase': 'idle'}
        def read(self):
            with lock: return copy.deepcopy(self.state)
        def save(self, old, new):
            with lock:
                if old['revision'] != self.state['revision']: raise app['Conflict']('State changed')
                self.state = {**new, 'revision': old['revision'] + 1}
                return self.read()

    class Checks:
        config = dict(region='ap-northeast-1',serverName='preview-battle-server',publicIp='192.0.2.10',vpcId='vpc-battle',subnetId='subnet-battle',gatewayId='igw-battle',routeTableId='rtb-battle',instanceProfileName='preview-battle-session',securityGroupId='sg-battle')

    def fixture():
        return json.loads(args.fixture_file.read_text()) if args.fixture_file else {}

    class FixtureBattle(app['Battle']):
        def health(self):
            if self.store.read()['phase'] == 'active' and fixture().get('healthy') is not True:
                raise app['NotReady']('UI fixture: AWS recovery is not ready yet.')
            return {'fixture': True}
        def apply(self, kind): pass
        def restore(self, kind): pass

    engine = FixtureBattle(Checks(), Store())
    app['battle'] = lambda: engine
    original = app['state_view']
    def view(value, language): return {**original(value,language), 'mode':'preview'}
    app['state_view'] = view

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self): self.dispatch()
        def do_POST(self): self.dispatch()
        def dispatch(self):
            try: size = int(self.headers.get('Content-Length','0'))
            except ValueError: self.send_error(400); return
            if size < 0 or size > 4096: self.send_error(413); return
            url = urlsplit(self.path)
            with lock:
                current = engine.store.read(); requested = fixture()
                if current['phase'] == 'idle' and current['index'] < len(app['KINDS']) and requested.get('round') == app['KINDS'][current['index']]:
                    engine.start(requested['round'])
                if requested.get('restore') is True: engine.recover(force=True)
                result = app['handler']({'rawPath':url.path,'rawQueryString':url.query,'requestContext':{'http':{'method':self.command}},'body':self.rfile.read(size).decode('utf-8',errors='replace')})
            body = result['body'].encode()
            self.send_response(result['statusCode'])
            for key,value in result['headers'].items(): self.send_header(key,value)
            self.send_header('content-length',str(len(body))); self.end_headers(); self.wfile.write(body)
    server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    url = f'http://127.0.0.1:{server.server_port}/{os.environ["PLAY_KEY"]}/'
    if args.info_file:
        descriptor = os.open(args.info_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(descriptor,'w') as stream: json.dump({'url':url,'cards':[url+'#card='+card for card in app['member_cards'](os.environ['COOPERATION_SECRET'])]},stream)
    print('UI fixtures only, no AWS or official scoring: '+url,flush=True)
    server.serve_forever()

if __name__ == '__main__': main()
