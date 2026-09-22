"""Package the shared AWS mission runtime with this Challenge's curriculum."""
import argparse
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FAMILY = ROOT.parents[1] / "runtimes" / "aws-intro"
# run_path gets its own namespace; all consumers use the same implementation.
family = runpy.run_path(str(FAMILY / "build.py"))

def template():
    return family["template"](ROOT)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    family["build"](ROOT, args.check)
