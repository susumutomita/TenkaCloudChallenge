import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BIN_DIR = process.env.LAB_BIN_DIR || join(HERE, "..", "bin");

function runProcess(file, args, { timeoutMs = 8000, env = {}, passFd3 = false } = {}) {
  return new Promise(async (resolve) => {
    const events = [];
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let eventFd = null;
    const stdio = passFd3
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "pipe", "pipe"];

    const child = spawn(file, args, {
      cwd: BIN_DIR,
      env: { ...process.env, ...env, ASAN_OPTIONS: env.ASAN_OPTIONS || "abort_on_error=0:halt_on_error=0:detect_leaks=0:print_summary=1" },
      stdio,
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        ok: false,
        timedOut: true,
        code: null,
        signal: "SIGKILL",
        stdout,
        stderr,
        events,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });

    if (passFd3 && child.stdio[3]) {
      child.stdio[3].setEncoding("utf8");
      let buf = "";
      child.stdio[3].on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          const m = /^LAB_EVENT tag=(.*)$/.exec(line);
          if (m) events.push(m[1]);
        }
      });
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        timedOut: false,
        code: null,
        signal: null,
        error: String(error.message || error),
        stdout,
        stderr,
        events,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({
        ok: code === 0,
        timedOut: false,
        code,
        signal,
        stdout,
        stderr,
        events,
      });
    });
  });
}

export function asanDetectedHeapUaf(stderr) {
  const text = String(stderr || "");
  return (
    /ERROR: AddressSanitizer/i.test(text) &&
    /heap-use-after-free/i.test(text)
  );
}

export function parseObs(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("OBS "));
  const fields = {};
  for (const line of lines) {
    const phase = /phase=([a-z0-9_]+)/.exec(line)?.[1];
    if (phase) fields.phase = phase;
    if (/stale=1/.test(line)) fields.staleAfterFree = true;
    if (/retained_cleared=1/.test(line)) fields.retainedCleared = true;
    if (/consume_rejected/.test(line)) fields.consumeRejected = true;
    if (/result=ok/.test(line)) fields.normalOk = true;
    if (/result=fixed/.test(line)) fields.fixedDone = true;
    if (/stack_local=/.test(line)) fields.sawStackLocal = true;
    if (/heap=/.test(line)) fields.sawHeap = true;
  }
  return { lines, ...fields };
}

export async function runBuggyAsan() {
  const result = await runProcess(join(BIN_DIR, "lab_buggy_asan"), ["uaf"], {
    timeoutMs: 10000,
  });
  return {
    ...result,
    asanHeapUaf: asanDetectedHeapUaf(result.stderr),
    obs: parseObs(result.stdout),
  };
}

export async function runFixedScenario() {
  const stale = await runProcess(join(BIN_DIR, "lab_fixed"), ["uaf"], { timeoutMs: 5000 });
  const normal = await runProcess(join(BIN_DIR, "lab_fixed"), ["normal"], {
    timeoutMs: 5000,
    passFd3: true,
  });
  const staleObs = parseObs(stale.stdout);
  const normalObs = parseObs(normal.stdout);
  return {
    stale,
    normal,
    staleObs,
    normalObs,
    fixedOk:
      Boolean(staleObs.retainedCleared) &&
      Boolean(staleObs.consumeRejected) &&
      !asanDetectedHeapUaf(stale.stderr) &&
      Boolean(normalObs.normalOk) &&
      normal.events.includes("normal-complete") &&
      normal.ok,
  };
}

export async function runLabEvent() {
  const result = await runProcess(join(BIN_DIR, "lab_fixed"), ["lab-event"], {
    timeoutMs: 5000,
    passFd3: true,
  });
  return {
    ...result,
    recorded: result.events.includes("checkpoint"),
  };
}

export async function runGdbBatch() {
  const binary = join(BIN_DIR, "lab_buggy");
  const gdbArgs = [
    "-batch",
    "-nx",
    "-ex", "set pagination off",
    "-ex", "set confirm off",
    "-ex", "break next_request_consume_stale",
    "-ex", "run",
    "-ex", "info frame",
    "-ex", "info locals",
    "-ex", "print/x worker_retained_note",
    "-ex", "print &worker_retained_note",
    "-ex", "bt 4",
    "--args",
    binary,
    "uaf",
  ];
  return runProcess("gdb", gdbArgs, { timeoutMs: 12000, env: { ASAN_OPTIONS: "" } });
}

export const QUIZ = Object.freeze({
  id: "stack-heap",
  // Correct: the stale thing is the heap object; the worker global is a pointer variable
  // that still holds the old address (its storage is not the freed object).
  correct: "heap-freed-pointer-kept",
});
