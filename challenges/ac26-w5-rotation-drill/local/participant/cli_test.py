"""Trusted CLI launcher: fetch public inputs, isolate, then load the edited starter."""
from pathlib import Path
import json,os,runpy,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from participant.evidence import public_evidence
from participant.isolation import block_network,protect_supervisor

payload=public_evidence()
public={'assignments':payload['assignments'],'public':payload['public']}
for name in ('FLAG_SEED','VERIFIER_PUBLIC_URL','VERIFIER_URL'):
    os.environ.pop(name,None)
os.environ['PUBLIC_EVIDENCE_JSON']=json.dumps(public)
protect_supervisor()
block_network()
sys.argv=[str(ROOT/'tests/public/test_rotation_drill.py'),*sys.argv[1:]]
runpy.run_path(sys.argv[0],run_name='__main__')
