"""Display only this deployment's public inputs."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from participant.evidence import public_evidence
print('p = から repair_noise = までの代入文をコピーします。 / Copy assignments from p = through repair_noise =.')
print(public_evidence()['assignments'])
