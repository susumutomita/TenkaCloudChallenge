"""Run optional CLI public tests with the same restrictions as the Portal editor."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from participant.server import _WORKBENCH, load_public_snapshot
from participant.isolation import protect_supervisor

def main():
    protect_supervisor()
    _WORKBENCH.public_payload=load_public_snapshot()
    result=_WORKBENCH._run_process(
        [sys.executable,'-I',str(ROOT/'tests/public/test_clock_drill.py'),*sys.argv[1:]],
        cwd=ROOT,env=_WORKBENCH._child_env(),timeout=_WORKBENCH.run_timeout_seconds)
    if result is None:
        print('public tests could not run under the required restrictions')
        return 1
    status,output=result
    print(output,end='')
    return status

if __name__=='__main__':
    raise SystemExit(main())
