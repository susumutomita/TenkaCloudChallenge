"""Display only this deployment's public inputs."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence
print('p = から offsets = までの代入文をコピーします。 / Copy assignments from p = through offsets =.')
print(public_evidence()['assignments'])
