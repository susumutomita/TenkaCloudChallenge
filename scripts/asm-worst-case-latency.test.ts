import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const LOCAL = join(REPO_ROOT, "challenges", "asm-worst-case-latency", "local");

function runPython(program: string): string {
  return execFileSync("python3", ["-c", program], {
    cwd: LOCAL,
    encoding: "utf8",
    env: {
      ...process.env,
      // The harness is what the container puts on the path; `splice` lives there.
      PYTHONPATH: [LOCAL, join(LOCAL, "harness"), process.env.PYTHONPATH ?? ""]
        .filter(Boolean).join(":"),
      FLAG_SEED: "local-dev-seed",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  }).trim();
}

describe("asm-worst-case-latency grading boundary", () => {
  it("derives a genuinely unseen generalize seed even when FLAG_SEED exceeds eight bytes", () => {
    const seeds = runPython([
      "from verifier.server import _seed_for",
      "print(_seed_for('measure'), _seed_for('generalize'))",
    ].join("\n")).split(" ");
    expect(seeds).toHaveLength(2);
    expect(seeds[1]).not.toBe(seeds[0]);
  });

  it("rejects jecxz because one control-flow instruction is still control flow", () => {
    // A full region, so the refusal is the control-flow rule rather than the
    // count rule that would refuse any short region.
    const verdict = runPython([
      "from splice import SPIN_COUNT",
      "from tests.hidden.check_candidate import Rejected, exactly_one_instruction",
      "try:",
      "    exactly_one_instruction(['jecxz'] * SPIN_COUNT)",
      "except Rejected as error:",
      "    print('rejected' if 'control flow' in str(error) else f'wrong reason: {error}')",
      "else:",
      "    print('accepted')",
    ].join("\n"));
    expect(verdict).toBe("rejected");
  });

  // The operand contract is checked on what the assembler built, not on what the
  // participant typed, so an encoding chosen in hex is judged like any other.
  const refusals: Array<[string, string]> = [
    ["an encoding smuggled in as raw bytes", ".byte 0x90"],
    ["a store encoded as raw bytes", ".byte 0x48,0x89,0x04,0x24"],
    ["a second statement behind the instruction", "nop; .globl smuggled"],
    ["an implicit stack write", "pushq %rax"],
    ["a string store to its implicit destination", "stosq"],
    ["a masked store to its implicit destination", "maskmovdqu %xmm0, %xmm1"],
    ["a symmetric instruction writing through its first operand", "xchg %rax, (%r8)"],
  ];
  for (const [what, instruction] of refusals) {
    it(`refuses ${what} before it is ever assembled into the frame`, () => {
      const verdict = runPython([
        "from splice import Rejected, build",
        "submission = 'tc_measured_begin:\\n" + instruction.replace(/\\/g, "\\\\") +
          "\\ntc_measured_end:\\n'",
        "try:",
        "    build(submission)",
        "except Rejected:",
        "    print('refused')",
        "else:",
        "    print('spliced')",
      ].join("\n"));
      expect(verdict).toBe("refused");
    });
  }

  it("keeps the repeat count out of any register the measured instruction can write", () => {
    const verdict = runPython([
      "from splice import SPIN_COUNT, build",
      "frame = build('tc_measured_begin:\\n    addq $1, %rax\\ntc_measured_end:\\n')",
      "region = frame.split('tc_measured_begin:')[1].split('tc_measured_end:')[0]",
      // An assembler-time unroll has no counter at run time, so there is no
      // repeat count in architectural state for the instruction to write to.
      "print('unrolled' if f'.rept {SPIN_COUNT}' in region else 'counted')",
    ].join("\n"));
    expect(verdict).toBe("unrolled");
  });

  it("saves every callee-saved register the SysV ABI promises the harness", () => {
    const verdict = runPython([
      "from splice import build",
      "frame = build('tc_measured_begin:\\n    addq $1, %rax\\ntc_measured_end:\\n')",
      "saved = {r for r in ('%rbx', '%rbp', '%r12', '%r13', '%r14', '%r15')",
      "         if f'pushq   {r}' in frame and f'popq    {r}' in frame}",
      "print('saved' if len(saved) == 6 else f'missing: {saved}')",
    ].join("\n"));
    expect(verdict).toBe("saved");
  });

  it("runs Workbench public tests through the same author-owned splice boundary", () => {
    const verdict = runPython([
      "from pathlib import Path",
      "from types import SimpleNamespace",
      "from workbench import server",
      "seen = {}",
      "def fake_run(command, **kwargs):",
      "    candidate = Path(command[-1])",
      "    seen['source'] = candidate.read_text(encoding='utf-8')",
      "    return SimpleNamespace(returncode=1, stderr='', stdout='')",
      "server.subprocess.run = fake_run",
      "submission = 'tc_measured_begin:\\n    addq $1, %rax\\ntc_measured_end:\\noutside_payload:\\n    ret\\n'",
      "server.run_public_tests('seed', {'candidate.S': submission})",
      "print('isolated' if 'outside_payload' not in seen['source'] else 'participant-owned')",
    ].join("\n"));
    expect(verdict).toBe("isolated");
  });

  it("requires the author reference to clear the hardest real checkpoint", () => {
    const verdict = runPython([
      "from mutation import REFERENCE_SCORE_FLOOR",
      "from verifier.server import THRESHOLDS",
      "print('aligned' if REFERENCE_SCORE_FLOOR >= max(THRESHOLDS.values()) else 'weaker')",
    ].join("\n"));
    expect(verdict).toBe("aligned");
  });

});
