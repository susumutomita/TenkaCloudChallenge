"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the
usage text appears, `show` describes the deployment without leaking the flag, and
a wrong answer is refused with a reason. The suite that grades the *answers* is
`mutation.py`, which is in the author image only.

    python tests/public/test_circuit.py
    python tests/public/test_circuit.py --only show
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.evaluator import satisfies
from fixtures.generate import SIGNALS, deployed_circuit, flag, honest_witnesses, params

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "circuit.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=120,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": SEED, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def test_usage(state: Path) -> list[str]:
    result = cli(state)
    failures = []
    if result.returncode != 0:
        failures.append("bare `circuit` should print usage and succeed")
    for expected in ("circuit show", "circuit check", "circuit repair", "circuit flag"):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    result = cli(state, "show")
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    prm = params(SEED)
    for expected in ("the policy", "the circuit that is deployed", "honest witnesses"):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    if str(prm["p"]) not in result.stdout:
        failures.append("`show` does not print this deployment's modulus")
    for constraint in deployed_circuit(SEED):
        if str(constraint["id"]) not in result.stdout:
            failures.append(f"`show` omits the deployed constraint {constraint['id']}")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_show_witnesses_are_honest(_state: Path) -> list[str]:
    """The witnesses `show` advertises really are accepted by the deployed circuit."""
    prm = params(SEED)
    failures = []
    for witness in honest_witnesses(prm):
        if not satisfies(deployed_circuit(SEED), witness, prm["p"]):
            failures.append(f"an advertised honest witness is rejected: {witness}")
        if sorted(witness) != sorted(SIGNALS):
            failures.append(f"an advertised honest witness names the wrong signals: {witness}")
    return failures


def test_flag_is_withheld(state: Path) -> list[str]:
    result = cli(state, "flag")
    failures = []
    if result.returncode == 0:
        failures.append("`flag` succeeded with nothing cleared")
    if flag(SEED) in result.stdout:
        failures.append("`flag` released the flag with nothing cleared")
    if "not yet" not in result.stdout:
        failures.append("`flag` does not say why it is withholding")
    return failures


def test_status_starts_open(state: Path) -> list[str]:
    result = cli(state, "status")
    return [] if result.stdout.count("open") == 2 else ["`status` does not start with both stages open"]


def test_honest_witness_is_not_a_forgery(state: Path) -> list[str]:
    prm = params(SEED)
    witness = honest_witnesses(prm)[0]
    result = cli(state, "check", *[f"{name}={witness[name]}" for name in SIGNALS])
    failures = []
    if result.returncode == 0:
        failures.append("`check` accepted an honest witness as a forgery")
    if "REJECTED" not in result.stdout:
        failures.append("`check` does not say it rejected the witness")
    return failures


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    cases = [
        (["check", "revoked=1"], "no value for"),
        (["check", "nonsense=1"], "unknown signal"),
        (["repair", "revoked ok"], "not an expression"),
        (["repair", "ok/revoked"], "division"),
        (["repair"], "no constraint given"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_no_op_repair_is_refused(state: Path) -> list[str]:
    result = cli(state, "repair", "0")
    return [] if result.returncode != 0 else ["`repair 0` was accepted"]


TESTS = {
    name[len("test_") :]: function
    for name, function in sorted(globals().items())
    if name.startswith("test_")
}


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    selected = {name: fn for name, fn in TESTS.items() if only in name}
    if not selected:
        print(f"no test matches --only {only!r}; names: {', '.join(TESTS)}")
        return 2
    failed = 0
    with tempfile.TemporaryDirectory() as directory:
        for name, function in selected.items():
            state = Path(directory) / name
            state.mkdir()
            failures = function(state)
            if failures:
                failed += 1
                print(f"FAIL {name}")
                for line in failures:
                    print(f"     {line}")
            else:
                print(f"ok   {name}")
    print()
    print(f"{len(selected) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
