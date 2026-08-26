import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "asm-worst-case-latency");
const LOCAL = join(PROBLEM, "local");

function read(relative: string): string {
  return readFileSync(join(PROBLEM, relative), "utf8");
}

function runPython(source: string): string {
  return execFileSync("python3", ["-c", source], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  }).trim();
}

function normalizeAuthorFrame(source: string): string {
  return source
    .slice(source.indexOf("    .text"))
    .replaceAll("tc_candidate", "tc_frame")
    .replaceAll("tc_baseline", "tc_frame")
    .split("\n")
    .filter((line) => !["tc_measured_begin:", "tc_measured_end:"].includes(line.trim()))
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .trim();
}

function probeRenderer(): {
  rendered: string;
  rejected: Record<string, boolean>;
} {
  const probe = String.raw`
import json
from harness.candidate import CandidateFormatError, render_candidate

bad = {
    "old-wrapper": """.text
.globl tc_candidate
tc_candidate:
    movl $6400, %ecx
tc_measured_begin:
    addq $1, %rax
tc_measured_end:
    decl %ecx
    jnz tc_measured_begin
    ret
""",
    "two-on-one-line": "addq $1, %rax; addq $1, %rax",
    "directive": ".rept 6400",
    "label": "again: addq $1, %rax",
}

rejected = {}
for name, source in bad.items():
    try:
        render_candidate(source)
    except CandidateFormatError:
        rejected[name] = True
    else:
        rejected[name] = False

print(json.dumps({
    "rendered": render_candidate("# one participant-owned instruction\naddq $1, %rax\n"),
    "rejected": rejected,
}))
`;
  const output = execFileSync("python3", ["-c", probe], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return JSON.parse(output) as { rendered: string; rejected: Record<string, boolean> };
}

describe("asm-worst-case-latency measurement boundary", () => {
  it("accepts one instruction and rejects participant-owned wrapper code", () => {
    const { rejected } = probeRenderer();
    expect(rejected).toEqual({
      "old-wrapper": true,
      "two-on-one-line": true,
      directive: true,
      label: true,
    });
  });

  it("fails closed on decoded mnemonics outside the reviewed scalar-integer set", () => {
    const verdict = JSON.parse(runPython([
      "import json",
      "from harness.candidate import CandidateFormatError, SPIN_COUNT, _validate_region",
      "accepted = []",
      "rejected = []",
      'for instruction in ("add $0x1, %rax", "mov (%r8), %r8", "idiv %rbx", "imul $0x3, %rax, %rax", "ror $0x1, %rax", "bsf %rax, %rbx", "cmovne %rax, %rbx", "setne %al", "movsbl %al, %ebx", "nop"):',
      "    _validate_region([instruction] * SPIN_COUNT)",
      "    accepted.append(instruction.split()[0])",
      'for instruction in ("lmsw %ax", "vmread %rax, %rbx", "pvalidate", "rdrand %rax", "addps %xmm0, %xmm1", "movq %xmm0, %rax", "movq %rax, %mm0", "cmp (%r8), %rax", "mov 0x8(%r8), %rax", "mov (%rax), %r8"):',
      "    try:",
      "        _validate_region([instruction] * SPIN_COUNT)",
      "    except CandidateFormatError:",
      "        rejected.append(instruction.split()[0])",
      "print(json.dumps({'accepted': accepted, 'rejected': rejected}))",
    ].join("\n"))) as { accepted: string[]; rejected: string[] };

    expect(verdict).toEqual({
      accepted: ["add", "mov", "idiv", "imul", "ror", "bsf", "cmovne", "setne", "movsbl", "nop"],
      rejected: ["lmsw", "vmread", "pvalidate", "rdrand", "addps", "movq", "movq", "cmp", "mov", "mov"],
    });
  });

  it("expands the instruction under an author-owned fixed repeat count", () => {
    const { rendered } = probeRenderer();
    expect(rendered).toContain('#include "arena.h"');
    expect(rendered).toContain(".rept TC_SPIN_COUNT");
    expect(rendered.match(/addq \$1, %rax/g)).toHaveLength(1);
    expect(rendered).not.toMatch(/mov[lq]\s+\$\d+,\s*%e?cx/);
    expect(rendered).not.toMatch(/\bdec[lq]?\s+%e?cx/);
    expect(rendered).not.toMatch(/\bj(?:n?z|mp)\b/);
    expect(rendered).toContain("movq    %rsp, %r15");
    expect(rendered).toContain("xorl    %esi, %esi");
    expect(rendered).toContain("xorl    %edi, %edi");
    expect(rendered).toContain("cmpq    %r15, %rsp");
  });

  it("uses the same safe object builder on public, Workbench, and hidden paths", () => {
    const publicTests = read("local/tests/public/test_candidate.py");
    const workbench = read("local/workbench/server.py");
    const hidden = read("local/tests/hidden/check_candidate.py");

    for (const source of [publicTests, workbench, hidden]) {
      expect(source).toContain("build_candidate_object");
    }
    expect(publicTests).not.toContain("str(SUBMISSION),");
    expect(workbench).not.toContain('str(work / "candidate.S"),');
  });

  it("bounds CPU, memory, and process use for both runtime services", () => {
    const compose = parse(read("local/docker-compose.yml")) as {
      services: Record<string, {
        cpus?: string;
        mem_limit?: string;
        pids_limit?: number;
        tmpfs?: string[];
      }>;
    };

    for (const name of ["workbench", "verifier"]) {
      expect(compose.services[name]).toMatchObject({
        cpus: "1.0",
        mem_limit: "1g",
        pids_limit: 128,
      });
      const tmp = compose.services[name].tmpfs?.find((entry) => entry.startsWith("/tmp:"));
      expect(tmp).toBeDefined();
      const options = new Set(tmp?.split(":", 2)[1]?.split(","));
      expect(options).toContain("exec");
      expect(options).not.toContain("noexec");
    }
  });

  it("keeps the baseline repeat count author-owned too", () => {
    const baseline = read("local/harness/baseline.S");
    expect(baseline).toContain('#include "arena.h"');
    expect(baseline).toContain(".rept TC_SPIN_COUNT");
    expect(baseline).not.toMatch(/mov[lq]\s+\$\d+,\s*%e?cx/);
    expect(baseline).not.toMatch(/\bdec[lq]?\s+%e?cx/);
    expect(baseline).not.toMatch(/\bj(?:n?z|mp)\b/);
    expect(baseline).toContain("movq    %rsp, %r15");
    expect(baseline).toContain("xorl    %esi, %esi");
    expect(baseline).toContain("xorl    %edi, %edi");
    expect(baseline).toContain("cmpq    %r15, %rsp");
  });

  it("keeps candidate and baseline frames identical outside the measured labels", () => {
    const candidate = probeRenderer().rendered;
    const baseline = read("local/harness/baseline.S");
    expect(normalizeAuthorFrame(candidate)).toBe(normalizeAuthorFrame(baseline));
  });

  it("keeps the original loop-count bypass in the mutation regression suite", () => {
    const mutation = read("local/mutation.py");
    expect(mutation).toContain("participant-owned loop count");
    expect(mutation).toContain("old full-function submission");
  });

  it("gates the exact PR head on a native-amd64 Docker runtime", () => {
    // The runtime proof used to be an unconditional job inside ci.yml, gated
    // through the `validate` aggregate. It now lives in its own path-filtered
    // workflow (the mcp-origin-guardian-runtime.yml shape) so an unrelated PR
    // does not pay for this native-amd64 Docker build and timing proof.
    const ciWorkflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const workflow = readFileSync(
      join(ROOT, ".github", "workflows", "asm-worst-case-latency-runtime.yml"),
      "utf8",
    );
    expect(workflow).toContain("asm-worst-case-latency-runtime:");
    expect(workflow).toContain("ref: ${{ github.event.pull_request.head.sha || github.sha }}");

    // Leaving the job in both places would silently reintroduce the double-run
    // cost this split exists to remove.
    expect(ciWorkflow).not.toContain("asm-worst-case-latency-runtime:");

    // A path filter narrower than what the proof depends on lets a real
    // regression merge unchecked, which is worse than no filter at all.
    expect(workflow).toContain("challenges/asm-worst-case-latency/**");
    expect(workflow).toContain("scripts/asm-worst-case-latency-http-smoke.py");
    expect(workflow).toContain(".github/workflows/asm-worst-case-latency-runtime.yml");
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(workflow).toContain("concurrency:");
    expect(workflow).toMatch(/cancel-in-progress:\s*true/);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(workflow).toContain('test "$(uname -m)" = x86_64');
    for (const flag of ["rdtscp", "constant_tsc", "nonstop_tsc", "clflush"]) {
      expect(workflow).toContain(flag);
    }
    expect(workflow).toContain("for seed in 7 42 1234 20260816");
    expect(workflow).toContain("for repetition in 1 2 3");
    expect(workflow).toContain("min(scores) < 40.0");
    expect(workflow).toContain("{{.HostConfig.NanoCpus}}");
    expect(workflow).toContain("= 1000000000");
    expect(workflow).toContain('fields[1] == "/tmp"');
    expect(workflow).toContain('"noexec" in options');
    expect(workflow).toContain("asm-worst-case-latency-http-smoke.py");
  });

  it("derives stable visible and domain-separated unseen seeds", () => {
    const probe = [
      "import json",
      "from verifier.server import _seed_for",
      'print(json.dumps({name: _seed_for(name) for name in ("measure", "miss", "generalize")}))',
    ].join("\n");
    const run = (): Record<string, number> => JSON.parse(execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "deployment-seed-longer-than-eight-bytes",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    })) as Record<string, number>;

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.measure).toBe(first.miss);
    expect(first.generalize).not.toBe(first.miss);
  });

  it("rejects a participant-owned wrapper before Workbench invokes the toolchain", () => {
    const probe = [
      "import json",
      "from workbench import server",
      "calls = []",
      "def forbidden_run(*args, **kwargs):",
      "    calls.append(args)",
      "    raise AssertionError('participant wrapper reached the toolchain')",
      "server.subprocess.run = forbidden_run",
      "submission = '''.text",
      ".globl tc_candidate",
      "tc_candidate:",
      "    movl $6400, %ecx",
      "tc_measured_begin:",
      "    addq $1, %rax",
      "tc_measured_end:",
      "    decl %ecx",
      "    jnz tc_measured_begin",
      "    ret",
      "'''",
      "verdict = server.run_public_tests('seed', {'candidate.S': submission})",
      "print(json.dumps({'passed': verdict['passed'], 'calls': len(calls)}))",
    ].join("\n");
    const verdict = JSON.parse(execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })) as { passed: boolean; calls: number };
    expect(verdict).toEqual({ passed: false, calls: 0 });
  });

  // The lab compiles its measurement into /tmp and then executes it. Docker
  // mounts a tmpfs noexec by default, and naming other options does not override
  // that, so a compose file that omits `exec` ships a lab whose binary cannot be
  // started -- the Workbench drops the connection mid-request and the verifier
  // scores nothing. Every service that builds and runs needs it said out loud.
  it("grants exec on the tmpfs the measurement is compiled and run from", () => {
    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    const mounts = compose.match(/^\s*-\s*\/tmp:.*$/gm) ?? [];
    expect(mounts.length).toBe(2);
    for (const mount of mounts) {
      expect(mount.split(":")[1]!.split(",")).toContain("exec");
    }
  });

  it("reports an unrunnable measurement instead of dropping the request", () => {
    // An OSError escaping the handler kills the thread and closes the socket, so
    // the participant sees no answer at all. It has to become an answer.
    const verdict = runPython([
      "import subprocess",
      "from workbench import server",
      "completed = subprocess.CompletedProcess",
      "server.build_candidate_object = lambda source, output: output.write_bytes(b'')",
      "def refuse(command, **kwargs):",
      "    if command[0] == 'gcc':",
      "        return completed(command, 0, '', '')",
      "    if str(command[0]).endswith('measure'):",
      "        raise PermissionError(13, 'Permission denied', str(command[0]))",
      "    raise AssertionError(f'unexpected command: {command!r}')",
      "server.subprocess.run = refuse",
      "starter = open('starter/candidate.S', encoding='utf-8').read()",
      "result = server.run_public_tests('seed', {'candidate.S': starter})",
      "ok = result['passed'] is False and 'cannot run its own measurement' in result['output']",
      "print('reported' if ok else f'leaked: {result!r}')",
    ].join("\n"));
    expect(verdict).toBe("reported");
  });

  it("requires the author reference to clear the hardest real checkpoint", () => {
    const verdict = runPython([
      "from mutation import REFERENCE_SCORE_FLOOR",
      "from verifier.server import THRESHOLDS",
      "print('aligned' if REFERENCE_SCORE_FLOOR == 2.0 * max(THRESHOLDS.values()) else 'weaker')",
    ].join("\n"));
    expect(verdict).toBe("aligned");
  });

});
