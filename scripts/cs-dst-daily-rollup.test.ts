import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-dst-daily-rollup");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []): string {
  return execFileSync("python3", [script, ...args], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

function probe(source: string): string {
  return execFileSync("python3", ["-c", source], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  }).trim();
}

describe("cs-dst-daily-rollup", () => {
  it("keeps the premise: the starter passes public tests and fails every hidden phase", () => {
    // The whole problem rests on this gap. If the starter ever fails a public test the
    // learner is told about the defect for free; if it ever passes a hidden phase there
    // is nothing left to discover.
    expect(python("tests/public/test_rollup.py")).toContain("all passed");
    const failures = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import rollup
from tests.hidden import check_rollup as check
print(json.dumps({
  "rollup": len(check.check_rollup(rollup, "repo-contract-seed")),
  "transition": len(check.check_transition(rollup, "repo-contract-seed")),
  "generalize": len(check.check_generalize(rollup, "repo-contract-seed")),
}))
`),
    ) as Record<string, number>;
    expect(Object.keys(failures).toSorted()).toEqual(["generalize", "rollup", "transition"]);
    for (const count of Object.values(failures)) expect(count).toBeGreaterThan(0);
  });

  it("names the day it got wrong, so the failure teaches rather than just fails", () => {
    const failures = probe(`
import sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import rollup
from tests.hidden import check_rollup as check
print("\\n".join(check.check_rollup(rollup, "repo-contract-seed")))
`);
    expect(failures).toContain("a transition day: ");
    expect(failures).toMatch(/totalled \d+ instead of \d+/);
  });

  it("catches the starter on every phase at every seed, not just the lucky ones", () => {
    // A wrong offset only misplaces an event across a day boundary, so if the generated
    // events were positioned at random a checkpoint's verdict would depend on the seed a
    // participant happened to draw. Both switch directions are covered for the same
    // reason: the spill is at the end of the shortened day one way and at the start of
    // the following day the other.
    const verdicts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
from tests.hidden import check_rollup as check
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
seeds = ["sweep-%02d" % i for i in range(20)]
out = {"referenceClean": True, "starterCaught": True, "labelMutantCaught": True}
for seed in seeds:
    reference = load("reference/rollup.py", "ref" + seed)
    starter = load("starter/rollup.py", "sta" + seed)
    mutant = load("mutants/sidecar_mutant.py", "mut" + seed)
    for phase in (check.check_rollup, check.check_transition, check.check_generalize):
        if phase(reference, seed): out["referenceClean"] = False
        if not phase(starter, seed): out["starterCaught"] = False
        if not phase(mutant, seed): out["labelMutantCaught"] = False
print(json.dumps(out))
`),
    ) as Record<string, boolean>;
    expect(verdicts).toEqual({
      referenceClean: true,
      starterCaught: true,
      labelMutantCaught: true,
    });
  });

  it("passes the reference and kills every offset, grouping and range mutant", () => {
    const output = python("mutation.py");
    expect(output).toContain("reference: passes");
    // The near-miss that matters: the labels are genuine local dates and the buckets
    // they name are not.
    expect(output).toContain("converts for display but groups by the UTC day");
    expect(output).toContain("applies the range's first offset to every instant");
    expect(output).toContain("all 10 mutations killed");
    expect(output).not.toContain("SURVIVED");
  });

  it("draws real transition dates from the tz database, in both directions", () => {
    // The evidence the participant is shown claims the day was not 24 hours long. That
    // has to be true of the actual date, measured from its own local midnight — a
    // UTC-cursor scan reports the day *after* an evening switch, which is ordinary.
    const measured = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fixtures.generate import reported_zone
lengths = set()
for seed in ["s%02d" % i for i in range(40)]:
    info = reported_zone(seed)
    zone = ZoneInfo(info["timezone"])
    day = datetime.fromisoformat(info["disputedDay"]).date()
    start = datetime(day.year, day.month, day.day, tzinfo=zone)
    end = datetime(day.year, day.month, day.day, tzinfo=zone) + timedelta(days=1)
    hours = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600
    lengths.add((hours, info["localHoursThatDay"]))
print(json.dumps(sorted(lengths)))
`),
    ) as [number, number][];
    // Every reported day really is short or long, and the number shown matches.
    for (const [actual, reported] of measured) {
      expect(actual).not.toBe(24);
      expect(reported).toBe(actual);
    }
    // Both directions occur, so the lab is not secretly a one-sided drill.
    expect(measured.some(([hours]) => hours < 24)).toBe(true);
    expect(measured.some(([hours]) => hours > 24)).toBe(true);
  });

  it("moves the audit answer with the seed, so it cannot be hard-coded", () => {
    const answers = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
from fixtures.generate import daily_report
def odd(seed):
    return [i for i, row in enumerate(daily_report(seed)) if row["reportedTotal"] != row["ledgerTotal"]]
print(json.dumps({seed: odd(seed) for seed in ["s%02d" % i for i in range(12)]}))
`),
    ) as Record<string, number[]>;
    const distinct = new Set(Object.values(answers).map((value) => value.join(",")));
    expect(distinct.size).toBeGreaterThan(1);
    // The amount one day lost turns up on the next: the discrepancy is always a pair.
    for (const indexes of Object.values(answers)) expect(indexes.length).toBe(2);
  });

  it("grades the reference through the verifier and refuses the starter", () => {
    const verdicts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("verifier_server", "verifier/server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
reference = open("reference/rollup.py", encoding="utf-8").read()
starter = open("starter/rollup.py", encoding="utf-8").read()
print(json.dumps({
  "reference": [server.evaluate(name, reference) for name in ("rollup", "transition", "generalize")],
  "starter": [server.evaluate(name, starter) for name in ("rollup", "transition", "generalize")],
}))
`),
    ) as Record<string, boolean[]>;
    expect(verdicts.reference).toEqual([true, true, true]);
    expect(verdicts.starter).toEqual([false, false, false]);
  });

  it("refuses a rollup that converts for display but still groups in UTC", () => {
    // Behavioural, not stylistic: it uses zoneinfo, never touches a fixed offset, and
    // every day label it emits is a real local date. The bucket is still the UTC day.
    const verdicts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("verifier_server", "verifier/server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
relabelled = open("mutants/sidecar_mutant.py", encoding="utf-8").read()
print(json.dumps([server.evaluate(name, relabelled) for name in ("rollup", "transition", "generalize")]))
`),
    ) as boolean[];
    expect(verdicts).toEqual([false, false, false]);
  });

  it("asks the question in the Portal, not only in the CLI", () => {
    // This is the defect that prompted the whole change: `question` and the column
    // glossary lived in show.py, and the Workbench rebuilt the payload by hand without
    // them. A participant solving in the Portal got raw JSON and was never told what
    // was being asked. Both surfaces now come from one builder, so they cannot drift.
    const both = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "workbench")
import server
from fixtures.generate import evidence
shared = evidence("repo-contract-seed")
portal = server.inspect_payload("repo-contract-seed")
portal["environment"].pop("python", None)
print(json.dumps({
  "identical": shared == portal,
  "questions": [bool(portal[s].get("question")) for s in ("environment", "observe", "audit")],
  "englishQuestions": [bool(portal[s]["i18n"]["en"].get("question")) for s in ("observe", "audit")],
  "columns": [sorted(portal[s]["columns"]) for s in ("observe", "audit")],
}))
`),
    ) as Record<string, unknown>;
    expect(both.identical).toBe(true);
    expect(both.questions).toEqual([true, true, true]);
    expect(both.englishQuestions).toEqual([true, true]);
    // Every column a participant is asked to reason about is explained.
    expect(both.columns).toEqual([
      ["day", "index", "ledgerTotal", "reportedTotal"],
      ["day", "index", "ledgerTotal", "reportedTotal"],
    ]);
  });

  it("always shows the disputed day in the observe evidence", () => {
    // It used to send rows[:4] while the mismatch sat at index 2, 3 or 4 depending on
    // the seed, so on 28 % of deployments the observe evidence contained no mismatching
    // row at all and still asked what was different about the day that stopped matching.
    const measured = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
from fixtures.generate import evidence, daily_report, reported_zone
missing = 0
leaks = 0
for i in range(200):
    seed = "s%03d" % i
    observe = evidence(seed)["observe"]
    shown = {row["index"] for row in observe["rows"]}
    rows = daily_report(seed)
    wrong = {j for j, r in enumerate(rows) if r["reportedTotal"] != r["ledgerTotal"]}
    if not (shown & wrong):
        missing += 1
    # The audit answer is the whole set; observe must not hand over all of it.
    if wrong <= shown:
        leaks += 1
    assert observe["report"]["disputedDay"] == reported_zone(seed)["disputedDay"]
print(json.dumps({"missing": missing, "leaks": leaks}))
`),
    ) as Record<string, number>;
    expect(measured.missing).toBe(0);
    // Exactly one of the pair is shown: the day that lost. Finding the day that gained
    // the same amount is the audit, so observe must not give the full answer away.
    expect(measured.leaks).toBe(0);
  });

  it("keeps the answer and the hidden properties out of the participant image", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = (dockerfile.split("FROM base AS participant")[1] ?? "").split(
      "FROM base AS verifier",
    )[0] as string;
    for (const forbidden of ["reference/", "tests/hidden/", "mutation.py", "mutants/"]) {
      expect(participant).not.toContain(forbidden);
    }
    // The verifier grades; it must not carry the answer either.
    const verifier = (dockerfile.split("FROM base AS verifier")[1] ?? "").split(
      "FROM participant AS author",
    )[0] as string;
    expect(verifier).not.toContain("reference/");
    expect(verifier).not.toContain("mutation.py");
    expect(dockerfile).toContain("FROM participant AS author");
    expect(dockerfile).toContain("USER lab");
  });

  it("publishes only the Workbench on host loopback", () => {
    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:18550:18550"');
    // The verifier's own healthcheck talks to 127.0.0.1:18551 *inside* its container,
    // which is fine. What must not exist is a published mapping for it: the assertion
    // is about `ports:` entries, not about the port number appearing anywhere.
    const published = [...compose.matchAll(/^\s+- "([\d.]+:\d+:\d+)"$/gm)].map((m) => m[1]);
    expect(published).toEqual(["127.0.0.1:18550:18550"]);
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("internal: true");
  });
});
