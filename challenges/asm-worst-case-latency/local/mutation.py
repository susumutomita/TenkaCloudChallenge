"""Mutation and runtime probes for the author-owned measurement contract.

Invalid submissions must be refused by the named static property before link or
execution.  The remaining probes mutate each author-owned property that cannot
be expressed by an assembly submission: serialization, fixed sample counts,
the robust statistic, affinity, normalized scoring, result shape, live host
metadata, and the unseen seed.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures import generate as fixtures
from fixtures.generate import stable_seed
from harness.candidate import CandidateFormatError, build_candidate_object, render_candidate
from tests.hidden import check_candidate as grader
from verifier.server import THRESHOLDS, _seed_for

REFERENCE_SCORE_FLOOR = 2.0 * max(THRESHOLDS.values())


def _seed() -> int:
    return stable_seed(os.environ.get("FLAG_SEED", "local-dev-seed"))


SEED = _seed()

OLD_WRAPPER = """    .text
    .globl tc_candidate
tc_candidate:
    movq %rdi, %r8
    movq %rsi, %rax
    movl $6400, %ecx
1:
tc_measured_begin:
    addq $1, %rax
tc_measured_end:
    decl %ecx
    jnz 1b
    ret
"""

# The old boundary let setup code replace the harness's buffered JSON at exit.
# Keeping the real exploit shape here proves that the original participant file
# is rejected and never linked, not merely that its measured ADD looks benign.
VERDICT_SPOOF = r""".section .rodata
fake:
    .ascii "{\"seed\":1,\"spins\":64,\"samples\":101}"
.text
handler:
    leaq fake(%rip), %rsi
    call write@PLT
    call _exit@PLT
.globl tc_candidate
tc_candidate:
    leaq handler(%rip), %rdi
    call atexit@PLT
tc_measured_begin:
    addq $1, %rax
tc_measured_end:
    ret
"""

# (name, source, fragment proving which property rejected it)
INVALID_SUBMISSIONS = [
    ("participant-owned loop count", OLD_WRAPPER, "exactly one instruction line"),
    ("native verdict spoof", VERDICT_SPOOF, "exactly one instruction line"),
    (
        "old full-function submission with decoy markers",
        """.text
.globl tc_candidate
tc_candidate:
    movl $6400, %ecx
slow:
    addq $1, %rax
    loop slow
    ret
tc_measured_begin:
    addq $1, %rax
tc_measured_end:
""",
        "exactly one instruction line",
    ),
    ("empty submission", "# no instruction\n", "exactly one instruction line"),
    ("two instructions on one line", "addq $1, %rax; addq $1, %rax", "directives"),
    (
        "constructor after a statement separator",
        'nop; .section .init_array,"aw"; .quad participant_constructor',
        "directives",
    ),
    ("assembler directive", ".rept 6400", "directives"),
    ("participant label", "again: addq $1, %rax", "directives"),
    ("control flow into the fixed marker", "jmp tc_measured_begin", "control flow"),
    ("jecxz control-flow alias", "jecxz tc_measured_begin", "control flow"),
    ("hidden repeat prefix", "repz ret", "instruction prefix"),
    ("segment-override prefix", "cs pause", "instruction prefix"),
    ("REX prefix variant", "rexx pause", "instruction prefix"),
    ("fixed sleep call", "call nanosleep", "control flow"),
    ("system call", "syscall", "not allowed"),
    (
        "implicit AVX masked store",
        "vmaskmovdqu %xmm0, %xmm1",
        "general-purpose integer registers",
    ),
    ("disable user interrupts", "clui", "not allowed"),
    ("enable user interrupts", "stui", "not allowed"),
    ("implicit user-interrupt return", "uiret", "not allowed"),
    ("participant timing", "rdtsc", "not allowed"),
    ("AMD performance timing", "rdpru", "not allowed"),
    ("deliberate stall", "pause", "not allowed"),
    ("cache flush", "clflush (%r8)", "not allowed"),
    ("cache demotion", "cldemote (%r8)", "not allowed"),
    ("privileged instruction", "hlt", "not allowed"),
    ("AMD virtualization instruction", "vmmcall", "not allowed"),
    ("load machine status word", "lmsw %ax", "not allowed"),
    ("non-serializing MSR write", "wrmsrns", "not allowed"),
    ("MSR list read", "rdmsrlist", "not allowed"),
    ("MSR list write", "wrmsrlist", "not allowed"),
    ("hardware reset hint", "hreset $0", "not allowed"),
    ("SEV page validation", "pvalidate", "not allowed"),
    ("SEV RMP adjustment", "rmpadjust", "not allowed"),
    ("VMX state read", "vmread %rax, %rbx", "not allowed"),
    ("VMX state write", "vmwrite %rax, %rbx", "not allowed"),
    ("TLB broadcast synchronization", "tlbsync", "not allowed"),
    ("SEV page smash", "psmash", "not allowed"),
    ("SEV RMP update", "rmpupdate", "not allowed"),
    ("SEV RMP query", "rmpquery", "not allowed"),
    ("TDX module return", "seamret", "not allowed"),
    (
        "load internal wrapping key",
        "loadiwkey %xmm0, %xmm1",
        "general-purpose integer registers",
    ),
    ("persistent-memory commit", "mcommit", "not allowed"),
    ("read user-interrupt state", "testui", "not allowed"),
    ("read local descriptor table", "sldt %ax", "not allowed"),
    ("read task register", "str %ax", "not allowed"),
    ("read machine status word", "smsw %ax", "not allowed"),
    ("debug-register alias", "movq %db0, %rax", "privileged control"),
    (
        "SIMD move into a GPR",
        "movq %xmm0, %rax",
        "general-purpose integer registers",
    ),
    (
        "SIMD move out of a GPR",
        "movq %rax, %xmm0",
        "general-purpose integer registers",
    ),
    (
        "MMX move into a GPR",
        "movq %mm0, %rax",
        "general-purpose integer registers",
    ),
    (
        "MMX move out of a GPR",
        "movq %rax, %mm0",
        "general-purpose integer registers",
    ),
    (
        "SIMD arithmetic outside the positive policy",
        "addps %xmm0, %xmm1",
        "general-purpose integer registers",
    ),
    (
        "x87 state mutation outside the positive policy",
        "fld1",
        "reviewed scalar-integer instruction set",
    ),
    (
        "memory comparison without an explicit result register",
        "cmpq (%r8), %rax",
        "place its result in an explicit general-purpose register",
    ),
    (
        "arena-relative out-of-bounds read",
        "movq 8(%r8), %rax",
        "arena entry at (%r8)",
    ),
    (
        "seed-derived memory address",
        "movq (%rax), %r8",
        "arena entry at (%r8)",
    ),
    (
        "unknown instruction outside positive policy",
        "rdrand %rax",
        "reviewed scalar-integer instruction set",
    ),
    ("privileged register operand", "movq %cr0, %rax", "privileged control"),
    ("segment-register addressing", "movq %fs:0, %rax", "segment-register"),
    ("arena store", "movq\t%rax, (%r8)", "write to memory"),
    ("argument-base store", "movq %rax, 67108864(%rdi)", "write to memory"),
    ("symmetric read-modify-write", "xchgq (%r8), %rax", "write to memory"),
    ("implicit-address direct store", "movdir64b (%r8), %rdi", "not allowed"),
    ("wrapper stack mutation", "pushq %rax", "not allowed"),
    ("wrapper guard mutation", "movq %rax, %r15", "reserved"),
    ("instruction-pointer-relative operand", "movq tc_measured_begin(%rip), %rax", "instruction-pointer"),
    ("external relocation", "movabsq $external_symbol, %rax", "relocations"),
    (
        "address-dependent non-identical copies",
        "movq $.-tc_measured_begin, %rax",
        "identical instruction copies",
    ),
]


def rejection_message(source: str) -> str | None:
    """Return the safe builder's pre-link rejection, if any."""
    with tempfile.TemporaryDirectory() as workspace:
        try:
            build_candidate_object(source, Path(workspace) / "candidate.o")
        except CandidateFormatError as error:
            return str(error)
    return None


def frame_fault_signal(root: Path, instruction: str) -> int | None:
    """Run an unsafe frame only inside this author mutation probe.

    Normal participant paths call ``build_candidate_object`` and reject these
    instructions before link. This deliberately bypasses final-object validation
    to prove the read-only arena and stack guard remain effective defense in depth.
    """
    with tempfile.TemporaryDirectory() as workspace:
        work = Path(workspace)
        candidate = work / "unsafe-candidate.S"
        candidate.write_text(render_candidate(instruction), encoding="utf-8")
        binary = work / "unsafe-measure"
        built = subprocess.run(
            [
                "gcc", "-O2", "-I", str(root / "harness"), "-o", str(binary),
                str(root / "harness" / "measure.c"),
                str(root / "harness" / "arena.c"),
                str(root / "harness" / "baseline.S"),
                str(candidate),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if built.returncode != 0:
            raise RuntimeError("unsafe frame probe did not link:\n" + built.stderr[-2000:])
        try:
            completed = subprocess.run(
                [str(binary), str(SEED)],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return None
    return -completed.returncode if completed.returncode < 0 else 0


def harness_contract_errors(source: str) -> list[str]:
    """Describe author-harness regressions represented by a source mutant."""
    errors: list[str] = []
    if any(name in source for name in ("clock_gettime(", "gettimeofday(", "nanosleep(")):
        errors.append("wall-clock or sleep replaced the cycle clock")
    if '"lfence\\n\\trdtsc"' not in source:
        errors.append("opening timer is not serialized")
    if source.count('"rdtscp\\n\\tlfence"') < 2:
        errors.append("closing timer is not serialized")
    if "#define SAMPLES 101" not in source or "#define WARMUP 8" not in source:
        errors.append("sample and warm-up counts are not fixed")
    if (
        "#define INTERRUPT_OUTLIER_MULTIPLIER 8" not in source
        or "reject_interrupt_outliers(&run)" not in source
    ):
        errors.append("interrupt-like high outliers are not rejected")
    if "qsort(run->cycles" not in source or "run->cycles[run->kept / 2]" not in source:
        errors.append("robust statistic is not the predeclared median")
    if "sched_getaffinity" not in source or "if (sched_setaffinity" not in source:
        errors.append("CPU affinity is not checked fail closed")
    if source.count("tc_arena_prepare(entry);") < 2:
        errors.append("the dependent path is not prepared outside the timing fence")
    return errors


def arena_contract_errors(source: str) -> list[str]:
    """Describe regressions in the runtime defense behind static store rejection."""
    errors: list[str] = []
    if "mmap(NULL, ARENA_BYTES, PROT_READ | PROT_WRITE" not in source:
        errors.append("arena construction is not isolated in its own mapping")
    if "mprotect(block, ARENA_BYTES, PROT_READ)" not in source:
        errors.append("arena is not made read-only before measurement")
    if "munmap(arena, ARENA_BYTES)" not in source:
        errors.append("arena mapping is not released with its exact extent")
    return errors


def synthetic_run(*, kept: int = 101, rejected: int = 0) -> dict:
    return {
        "seed": SEED,
        "spins": 64,
        "samples": 101,
        "baseline": {
            "robustCycles": 100,
            "kept": kept,
            "rejected": rejected,
            "rejectedMigration": rejected,
            "rejectedInterrupt": 0,
        },
        "candidate": {
            "robustCycles": 250,
            "kept": kept,
            "rejected": rejected,
            "rejectedMigration": rejected,
            "rejectedInterrupt": 0,
        },
        "checksum": "0",
    }


def property_failures(root: Path) -> list[str]:
    failures: list[str] = []

    if grader.normalized_score(synthetic_run()) != 2.5:
        failures.append("normalized_score no longer computes candidate / baseline")
    try:
        grader.reject_migration_or_interrupt(synthetic_run(kept=50, rejected=51))
    except grader.Rejected:
        pass
    else:
        failures.append("migration-majority rejection is not load-bearing")
    try:
        grader.reject_migration_or_interrupt(synthetic_run(kept=51, rejected=50))
    except grader.Rejected:
        failures.append("a majority-clean run is rejected")

    try:
        grader.well_formed_result({**synthetic_run(), "samples": 100}, SEED)
    except grader.Rejected:
        pass
    else:
        failures.append("fixed result metadata is not load-bearing")

    expected_thresholds = {"measure": 0.75, "dependency": 3.0, "miss": 20.0, "generalize": 20.0}
    if THRESHOLDS != expected_thresholds:
        failures.append(f"checkpoint thresholds drifted: {THRESHOLDS!r}")
    if _seed_for("measure") == _seed_for("generalize"):
        failures.append("generalize seed is not domain-separated")

    measure_source = (root / "harness" / "measure.c").read_text(encoding="utf-8")
    if harness_contract_errors(measure_source):
        failures.append("the intact measurement harness violates its own source contract")
    harness_mutants = [
        (
            "missing opening serialization",
            measure_source.replace('"lfence\\n\\trdtsc"', '"rdtsc"', 1),
            "opening timer",
        ),
        (
            "missing closing serialization",
            measure_source.replace('"rdtscp\\n\\tlfence"', '"rdtscp"'),
            "closing timer",
        ),
        (
            "wall-clock only",
            measure_source.replace("static inline uint64_t fence_open(void)", "clock_gettime(void)"),
            "wall-clock",
        ),
        (
            "variable run count",
            measure_source.replace("#define SAMPLES 101", "#define SAMPLES 1"),
            "counts",
        ),
        (
            "outlier cherry-pick",
            measure_source.replace("run->cycles[run->kept / 2]", "run->cycles[run->kept - 1]"),
            "median",
        ),
        (
            "interrupt outlier accepted",
            measure_source.replace(
                "reject_interrupt_outliers(&run);",
                "/* interrupt outlier rejection removed */",
            ),
            "interrupt-like",
        ),
        (
            "ignored affinity failure",
            measure_source.replace("if (sched_setaffinity", "if_ignored (sched_setaffinity"),
            "affinity",
        ),
        (
            "missing cache preparation",
            measure_source.replace("tc_arena_prepare(entry);", "/* preparation removed */"),
            "prepared",
        ),
    ]
    for name, mutant, expected in harness_mutants:
        if not any(expected in error for error in harness_contract_errors(mutant)):
            failures.append(f"harness mutation survived: {name}")

    arena_source = (root / "harness" / "arena.c").read_text(encoding="utf-8")
    if arena_contract_errors(arena_source):
        failures.append("the intact arena violates its read-only runtime boundary")
    writable_arena = arena_source.replace(
        "mprotect(block, ARENA_BYTES, PROT_READ)",
        "mprotect(block, ARENA_BYTES, PROT_READ | PROT_WRITE)",
    )
    if not any("read-only" in error for error in arena_contract_errors(writable_arena)):
        failures.append("arena read-only mutation survived")

    def report(suffix: str, flags: str) -> dict:
        cpu = {"model name": f"model-{suffix}", "microcode": f"microcode-{suffix}", "flags": flags}

        def host_value(*paths: str) -> str:
            return f"governor-{suffix}" if any("governor" in path for path in paths) else f"vm-{suffix}"

        with (
            patch.object(fixtures, "_cpuinfo", return_value=cpu),
            patch.object(fixtures, "_read_host_value", side_effect=host_value),
            patch.object(fixtures.platform, "machine", return_value=f"arch-{suffix}"),
            patch.object(fixtures.platform, "release", return_value=f"kernel-{suffix}"),
        ):
            return fixtures.host_report()

    first = report("a", "hypervisor rdtscp constant_tsc nonstop_tsc clflush")
    second = report("b", "")
    derived = ("architecture", "cpuModel", "microcode", "kernel", "hypervisor", "governor", "cpuFlags")
    if any(first[field] == second[field] for field in derived):
        failures.append("host result metadata contains a hard-coded field")
    return failures


def main() -> int:
    root = Path(__file__).parent
    reference = (root / "reference" / "candidate.S").read_text(encoding="utf-8")
    starter = (root / "starter" / "candidate.S").read_text(encoding="utf-8")

    survivors: list[str] = []
    for name, source, expected in INVALID_SUBMISSIONS:
        message = rejection_message(source)
        if message is None or expected not in message:
            print(f"SURVIVED named static property: {name} ({message!r})")
            survivors.append(name)
            continue
        try:
            grader.grade(source, SEED)
        except grader.Rejected as error:
            if expected not in str(error):
                print(f"SURVIVED verifier integration: {name} ({error})")
                survivors.append(name)
                continue
        else:
            print(f"SURVIVED verifier integration: {name}")
            survivors.append(name)
            continue
        print(f"rejected before link by '{expected}': {name}")

    properties = property_failures(root)
    for failure in properties:
        print(f"SURVIVED author property: {failure}")
    if survivors or properties:
        print(f"{len(survivors) + len(properties)} mutation(s) survived")
        return 1

    frame_probes = (
        ("read-only arena", "movq %rax, (%r8)", 11),
        ("stack-pointer guard", "pushq %rax", 4),
    )
    for name, instruction, expected_signal in frame_probes:
        observed = frame_fault_signal(root, instruction)
        if observed != expected_signal:
            print(
                f"SURVIVED runtime frame property: {name} "
                f"(signal={observed!r}, expected={expected_signal})"
            )
            return 1
        print(f"runtime frame rejected by signal {observed}: {name}")

    reference_result = grader.grade(reference, SEED)
    if reference_result["normalizedScore"] < REFERENCE_SCORE_FLOOR:
        print(f"the reference only reached {reference_result['normalizedScore']:.1f}x the baseline")
        return 1
    print(f"reference: {reference_result['normalizedScore']:.1f}x the baseline")

    starter_result = grader.grade(starter, SEED)
    if not 0.75 <= starter_result["normalizedScore"] <= 2.0:
        print(f"the starter score is outside its stable window: {starter_result['normalizedScore']:.2f}x")
        return 1
    print(f"starter:   {starter_result['normalizedScore']:.2f}x the baseline")

    # The concrete bypass changed an outer loop from 64 to 6400. It is now only
    # one harmless instruction repeated by the fixed wrapper.
    count_result = grader.grade("movl $6400, %ecx", SEED)
    if count_result["normalizedScore"] > 2.0:
        print(
            "the former loop-count payload still inflated the score to "
            f"{count_result['normalizedScore']:.1f}x"
        )
        return 1
    print(f"fixed-count probe: {count_result['normalizedScore']:.2f}x the baseline")

    callee_saved_result = grader.grade("movq $1, %rbx", SEED)
    if callee_saved_result["normalizedScore"] > 2.0:
        print(
            "a legal callee-saved destination produced an unstable score: "
            f"{callee_saved_result['normalizedScore']:.1f}x"
        )
        return 1
    print(f"callee-saved probe: {callee_saved_result['normalizedScore']:.2f}x the baseline")

    print(
        f"all {len(INVALID_SUBMISSIONS)} invalid submissions and "
        "all author-property mutations were killed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
