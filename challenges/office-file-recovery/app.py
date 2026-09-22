"""Load the same source that is embedded in this Challenge's Lambda."""
import runpy
from pathlib import Path

_problem = Path(__file__).resolve().parent
_family = _problem.parents[1] / "runtimes" / "aws-intro"
_builder = runpy.run_path(str(_family / "build.py"))
exec(compile(_builder["compile_code"](_problem), "index.py", "exec"))
