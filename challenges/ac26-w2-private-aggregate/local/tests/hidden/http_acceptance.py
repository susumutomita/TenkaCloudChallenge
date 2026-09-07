"""Real problem HTTP checks. Requires only the dedicated local Compose service."""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get('AC26_WORKBENCH_URL', 'http://127.0.0.1:18153').rstrip('/')
CHECKPOINTS = ('plan', 'share-inputs', 'linear', 'multiply', 'result', 'privacy', 'cost', 'transfer')


def post(path, payload):
    request = urllib.request.Request(BASE + path, json.dumps(payload).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=40) as response:
        return json.load(response)


def main():
    metadata = json.loads((ROOT.parents[2]/'metadata.json').read_text())
    config = get('/api/config')
    assert [c['id'] for c in config['checkpoints']] == list(CHECKPOINTS)
    assert {c['id']:c['label'] for c in config['checkpoints']} == {c['id']:c['label'] for c in metadata['scoring']['checks']}
    assert config['i18n']['en']['checkpointLabels'] == {c['id']:c['label'] for c in metadata['i18n']['en']['checks']}
    assert all(c['kind'] == 'code' for c in config['checkpoints'])
    inspect = get('/api/inspect')['output']
    assert 'triple_list[0].a' in inspect and 'all shares' in inspect and 'Traceback' not in inspect
    print('config_ja_en_and_inspect', 'passed')
    source = (ROOT / 'portal/reader-aggregate.py').read_text()
    digest = hashlib.sha256(source.encode()).hexdigest()
    assert digest == '68f80983819ee810e543608dda56cfbc105488a58a1d4de2ce39b41aa6ea79a3'
    print('reader_sha256', digest)
    prepared = post('/api/prepare', {'files': {'aggregate.py': source}, 'manual': {}})
    assert prepared['ok'], prepared
    for checkpoint in CHECKPOINTS:
        sealed = prepared['submissions'][checkpoint]
        assert sealed.startswith('tcw1.')
        result = post('/verify', {'checkpointId': checkpoint, 'submission': sealed})
        assert result.get('checkpointId') == checkpoint and result.get('correct') is True, result
        print(json.dumps({'case': 'unchanged-reader-prepared', **result}))
    public = post('/api/test', {'files': {'aggregate.py': source}})
    assert public.get('passed') is True, public
    print(json.dumps({'case': 'unchanged-reader-public', **public}))
    spoof = 'import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)\n'
    cases = [('printed-verdict', spoof, 'multiply'),
             ('rewritten-observations', (ROOT/'forged-observations.py').read_text(), 'privacy'),
             ('rewritten-observations', (ROOT/'forged-observations.py').read_text(), 'cost'),
             ('wrong-score', source+'\ndef aggregate(c,s,t,spec,io):return [0]*spec["parties"]\n', 'multiply')]
    for name, submission, checkpoint in cases:
        result = post('/verify', {'checkpointId': checkpoint, 'submission': submission})
        assert result.get('checkpointId') == checkpoint and result.get('correct') is False, result
        print(json.dumps({'case': name, **result}))
    failed = post('/api/test', {'files': {'aggregate.py': spoof}})
    assert failed.get('passed') is False, failed
    print(json.dumps({'case': 'printed-verdict-public', **failed}))


if __name__ == '__main__':
    main()
