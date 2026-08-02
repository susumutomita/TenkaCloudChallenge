"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the
usage text appears, `show` describes the deployment without leaking the flag or a
residual, the transfer circuit stays shut until it is earned, and a wrong answer is
refused with a reason. The suite that grades the *answers* is `mutation.py`, which
is in the author image only.

    python tests/public/test_audit.py
    python tests/public/test_audit.py --only show
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.evaluator import trace
from fixtures.generate import (
    LIVE,
    TRANSFER,
    circuit,
    field_modulus,
    flag,
    honest_witness,
)

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "audit.py"), *arguments],
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
        failures.append("bare `audit` should print usage and succeed")
    for expected in ("audit show", "audit explain", "audit trace", "audit admit", "audit flag"):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    result = cli(state, "show")
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    for expected in ("how to read a constraint", "the circuit", "the witness the monitor refused"):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    if str(field_modulus(SEED, LIVE)) not in result.stdout:
        failures.append("`show` does not print this deployment's modulus")
    for constraint in circuit(SEED, LIVE):
        if str(constraint["id"]) not in result.stdout:
            failures.append(f"`show` omits the deployed constraint {constraint['id']}")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_show_locks_the_transfer_circuit(state: Path) -> list[str]:
    """The second circuit is earned: named as locked, with its contents withheld.

    Locked rather than absent. A section that simply is not there reads as a broken
    page, and there is no scrollback in the portal terminal to compare against.
    """
    stdout = cli(state, "show").stdout
    failures = [
        f"`show` reveals the transfer constraint {constraint['id']} before it is unlocked"
        for constraint in circuit(SEED, TRANSFER)
        if str(constraint["id"]) in stdout
    ]
    if "[locked]" not in stdout:
        failures.append("`show` omits the locked stage instead of naming it")
    return failures


def test_show_honest_witness_really_is_honest(_state: Path) -> list[str]:
    """The witness `show` advertises as satisfying really does satisfy the circuit."""
    failures = []
    for case in (LIVE, TRANSFER):
        p = field_modulus(SEED, case)
        residuals = trace(circuit(SEED, case), honest_witness(SEED, case), p)
        if any(residual != 0 for residual in residuals):
            failures.append(f"the advertised honest witness for {case} has a non-zero residual")
    return failures


def test_explain_names_operands_without_values(state: Path) -> list[str]:
    result = cli(state, "explain", "c2")
    failures = []
    if result.returncode != 0:
        failures.append("`explain c2` failed")
    if "residual:" not in result.stdout:
        failures.append("`explain` does not print the residual")
    if "role" not in result.stdout:
        failures.append("`explain c2` does not name its operands")
    return failures


def test_explain_refuses_the_transfer_circuit(state: Path) -> list[str]:
    result = cli(state, "explain", str(circuit(SEED, TRANSFER)[0]["id"]))
    failures = []
    if result.returncode == 0:
        failures.append("`explain` described a constraint from a circuit not yet handed over")
    if "not been handed" not in result.stdout:
        failures.append("`explain` does not say why it refused")
    return failures


def test_transfer_is_locked(state: Path) -> list[str]:
    result = cli(state, "transfer", "0,0,0,0,0,0")
    failures = []
    if result.returncode == 0:
        failures.append("`transfer` was gradeable before the first two stages")
    if "has not been handed over" not in result.stdout:
        failures.append("`transfer` does not say why it refused")
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
    if result.stdout.count("open") == 3:
        return []
    return ["`status` does not start with all three stages open"]


def test_an_all_zero_trace_is_refused(state: Path) -> list[str]:
    """The witness `show` calls refused really is refused, so its trace is not all zeros."""
    zeros = ",".join("0" for _ in circuit(SEED, LIVE))
    result = cli(state, "trace", zeros)
    failures = []
    if result.returncode == 0:
        failures.append("a trace of all zeros was accepted for a witness that was refused")
    if "REJECTED" not in result.stdout:
        failures.append("`trace` does not say it rejected the submission")
    return failures


def test_rejection_does_not_name_the_wrong_entries(state: Path) -> list[str]:
    """A rejection reports how many entries are wrong, never which.

    Naming them would hand over a map of where the mistakes are, which is the work
    the stage exists for. It is not claimed to prevent a scripted search.
    """
    zeros = ",".join("0" for _ in circuit(SEED, LIVE))
    stdout = cli(state, "trace", zeros).stdout
    return [
        f"`trace` named constraint {constraint['id']} in its rejection"
        for constraint in circuit(SEED, LIVE)
        if str(constraint["id"]) in stdout
    ]


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    p = field_modulus(SEED, LIVE)
    cases = [
        (["trace", "0,0"], "residuals given"),
        (["trace", "0,0,0,0,x"], "not an integer"),
        (["trace", f"0,0,0,0,{p}"], "not an element of the field"),
        (["trace"], "no residuals given"),
        (["admit", "tier tier"], "not an expression"),
        (["admit", "1/tier"], "division"),
        (["admit"], "no expression given"),
        (["explain", "c99"], "no constraint with id"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_a_constant_gadget_is_refused(state: Path) -> list[str]:
    result = cli(state, "admit", "0")
    return [] if result.returncode != 0 else ["`admit 0` was accepted"]


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
