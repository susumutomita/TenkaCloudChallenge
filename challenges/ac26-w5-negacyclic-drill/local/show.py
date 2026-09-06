"""Display only this deployment's public inputs."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence
print('p = から encoding = までの代入文をコピーします。 / Copy assignments from p = through encoding =.')
print(public_evidence()['assignments'])
