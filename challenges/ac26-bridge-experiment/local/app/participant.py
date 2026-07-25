"""Load and run the participant's `counter.py` without trusting it.

The submission is bind-mounted read-only at /workspace/solution. It is copied into
a private temporary workspace before being imported, so:

  * the source tree is never written to by verification;
  * a module-level side effect cannot see or mutate the fixtures module;
  * a later edit mid-verification cannot change what was executed.

Every failure mode a participant can cause — syntax error, missing function,
exception, wrong return type, an infinite loop — is converted into a
ParticipantError. The verifier must stay up: a submission that crashes the
verifier process would take the whole challenge down with it.
"""

from __future__ import annotations

import importlib.util
import multiprocessing
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Callable

SOLUTION_DIR = Path("/workspace/solution")
SOLUTION_FILE = "counter.py"

# A correct solution is a few microseconds. Anything past this is a loop that
# does not terminate, not a slow-but-right answer.
TIMEOUT_SECONDS = 10.0
MAX_ROUNDS = 10_000


class ParticipantError(RuntimeError):
    """Anything wrong with the submission, phrased for the participant."""


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location("participant_counter", path)
    if spec is None or spec.loader is None:
        raise ParticipantError(f"{SOLUTION_FILE} could not be loaded")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except NotImplementedError as error:
        raise ParticipantError(f"advance() is not implemented yet: {error}") from error
    except SyntaxError as error:
        raise ParticipantError(
            f"{SOLUTION_FILE} has a syntax error on line {error.lineno}"
        ) from error
    except Exception as error:  # noqa: BLE001 - any import-time failure is the participant's
        raise ParticipantError(f"{SOLUTION_FILE} failed while importing: {error!r}") from error
    return module


def load_advance() -> Callable[[int, int, int, int], list[int]]:
    """Import the submission from a private copy and return its `advance`."""
    source = SOLUTION_DIR / SOLUTION_FILE
    if not source.is_file():
        raise ParticipantError(f"{SOLUTION_DIR}/{SOLUTION_FILE} not found")

    workspace = Path(tempfile.mkdtemp(prefix="ac26-bridge-"))
    try:
        copy = workspace / SOLUTION_FILE
        shutil.copyfile(source, copy)
        module = _load_module(copy)
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    advance = getattr(module, "advance", None)
    if advance is None:
        raise ParticipantError(f"{SOLUTION_FILE} does not define advance()")
    if not callable(advance):
        raise ParticipantError("advance is defined but is not a function")
    return advance


def call_advance(
    advance: Callable[[int, int, int, int], list[int]],
    start: int,
    step: int,
    rounds: int,
    modulus: int,
) -> list[int]:
    """Call an already-loaded `advance` in-process, normalizing every failure.

    Used by the participant-facing harness, where a traceback into the private
    temporary copy would point at a path the participant cannot open. The verifier
    uses `run_advance` instead, which pays for a subprocess to get a hard timeout.
    """
    try:
        values = list(advance(start, step, rounds, modulus))
    except NotImplementedError as error:
        raise ParticipantError(f"advance() is not implemented yet: {error}") from error
    except Exception as error:  # noqa: BLE001 - any runtime failure is the participant's
        raise ParticipantError(f"advance() raised {error!r}") from error
    if not all(isinstance(value, int) for value in values):
        raise ParticipantError("advance() must return a list of ints")
    return values


def _worker(queue: "multiprocessing.Queue", start: int, step: int, rounds: int, modulus: int):
    try:
        advance = load_advance()
        queue.put(("ok", list(advance(start, step, rounds, modulus))))
    except ParticipantError as error:
        queue.put(("error", str(error)))
    except Exception as error:  # noqa: BLE001 - runtime failure inside the submission
        queue.put(("error", f"advance() raised {error!r}"))


def run_advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Run the submission in a separate process with a hard wall-clock timeout.

    A plain in-process call cannot be interrupted, so an infinite loop in the
    submission would wedge the verifier permanently.
    """
    if rounds > MAX_ROUNDS:
        raise ParticipantError("too many rounds requested")

    queue: multiprocessing.Queue = multiprocessing.Queue()
    process = multiprocessing.Process(
        target=_worker, args=(queue, start, step, rounds, modulus), daemon=True
    )
    process.start()
    process.join(TIMEOUT_SECONDS)
    if process.is_alive():
        process.kill()
        process.join()
        raise ParticipantError(
            f"advance() did not finish within {TIMEOUT_SECONDS:.0f}s — is the loop terminating?"
        )
    if queue.empty():
        raise ParticipantError("advance() exited without returning a result")

    status, payload = queue.get()
    if status == "error":
        raise ParticipantError(str(payload))

    values = payload
    if not isinstance(values, list) or not all(isinstance(v, int) for v in values):
        raise ParticipantError("advance() must return a list of ints")
    return values


if sys.platform != "win32":
    # "fork" would inherit the verifier's imported fixtures module, letting a
    # submission read the expected values out of the parent's memory.
    multiprocessing.set_start_method("spawn", force=True)
