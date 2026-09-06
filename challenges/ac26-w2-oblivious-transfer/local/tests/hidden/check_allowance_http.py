"""Author-only real HTTP checks; requires an already running dedicated Workbench."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    source = (Path(__file__).parent / 'portal/reader-oblivious.py').read_text()
    assert hashlib.sha256(source.encode()).hexdigest() == '7edb056890be2aa84c07baab3b871298b88a4c82fbd866d370aaea2f0a5bd896'

    def post(path, body):
        request = Request(args.base_url + path, data=json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=40) as response:
            return json.load(response)

    def verify(name, submitted, checkpoint='request', expected=True):
        started = time.monotonic()
        prepared = post('/api/prepare', {'files': {'oblivious.py': submitted}})
        verdict = post('/verify', {'checkpointId': checkpoint,
                                  'submission': prepared['submissions'][checkpoint]})
        print(json.dumps({'variant': name, 'checkpointId': checkpoint,
                          'correct': verdict.get('correct'),
                          'elapsed': round(time.monotonic() - started, 3)}), flush=True)
        assert verdict.get('checkpointId') == checkpoint
        assert verdict.get('correct') is expected

    public = post('/api/test', {'files': {'oblivious.py': source}})
    print(json.dumps({'variant': 'frozen-reader-public', **public}), flush=True)
    assert public['passed'] is True
    for checkpoint in ('request', 'choice-privacy', 'transfer', 'and-gate', 'gate-privacy', 'unseen'):
        verify('frozen-reader', source, checkpoint)

    verify('computation-imports', source + '\nimport fractions, statistics, random\n'
           'assert fractions.Fraction(2,4) == fractions.Fraction(1,2)\n'
           'assert statistics.mean([1,3]) == 2\n'
           'assert random.Random(7).randrange(1) == 0\n')
    # These use elapsed time, not CPU time, so a 15-second proxy truncation and
    # the unchanged 20-second evaluator deadline are separate observations.
    verify('valid-16-second-startup', source + '\nimport time\ntime.sleep(16)\n')
    verify('over-20-second-startup', source + '\nimport time\ntime.sleep(21)\n', expected=False)


if __name__ == '__main__':
    main()
