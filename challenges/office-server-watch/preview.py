"""Run the shared, explicitly labelled local UI preview."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if __name__ == "__main__":
    runpy.run_path(str(ROOT.parents[1] / "runtimes" / "aws-intro" / "preview.py"))["main"](ROOT)
