import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { localPlayProblemDirs, localPlayVerifiers } from "./lib/local-play-problems";

/**
 * The verifier has to be reachable through the published port, and only from this host.
 *
 * Those are two different addresses and it is easy to conflate them:
 *
 *   - Inside the container, the server must bind every interface. A published port is
 *     forwarded to the container's bridge address, so a server listening on `127.0.0.1`
 *     *inside* the container accepts nothing from outside it. The connection opens and
 *     closes with no response, and the platform can never score the problem.
 *   - On the host, the publish must be `127.0.0.1:<port>:<port>`, which is what actually
 *     keeps the endpoint off the network.
 *
 * `127.0.0.1` inside the container looks like the careful choice and is the broken one. It
 * was the shipped state of 22 of the 33 local-play problems when this file was written:
 * the 11 later AC26 problems carry the fix and its comment, the earlier ones — including
 * `ac26-bridge-experiment`, which every problem is scaffolded from — did not. So the fix
 * existed, the scaffolder kept handing out the version without it, and nothing failed.
 *
 * That is the same failure shape as the other catalog-wide guards: a correction that
 * reached some problems and then rotted, because nothing asserted it. It is invisible in
 * normal authoring for a specific reason — `make test`, `make test-one`, `make inspect` and
 * `make reference-test` all `docker run` into the container and never cross the published
 * port, so an author exercises every target they use and still never touches this path.
 *
 * Selected structurally rather than by name, for the reason in `lib/local-play-problems.ts`.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const VERIFIERS = localPlayVerifiers(REPO_ROOT);
const PROBLEM_DIRS = localPlayProblemDirs(REPO_ROOT);

/** Addresses that mean "every interface" to `socket.bind`. */
const WILDCARD_BIND = /HTTPServer\(\(\s*("0\.0\.0\.0"|""|"::")\s*,\s*port\s*\)/;

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("local-play verifier reachability", () => {
  it("should find verifiers to check, so a glob matching nothing cannot pass", () => {
    expect(VERIFIERS.length).toBeGreaterThan(0);
  });

  it.each(VERIFIERS)("%s should bind every interface inside the container", (relative) => {
    const source = read(relative);
    expect(source).toMatch(WILDCARD_BIND);
    // The specific wrong value, named so the failure explains itself.
    expect(source).not.toContain('HTTPServer(("127.0.0.1", port)');
  });

  it.each(VERIFIERS)("%s should say why it binds every interface", (relative) => {
    // Without the comment the next author reads `0.0.0.0` as sloppiness and "fixes" it back
    // to 127.0.0.1, which is exactly how this regressed the first time.
    const source = read(relative);
    expect(source).toMatch(/inside the container/i);
    expect(source).toMatch(/docker-compose\.yml/);
  });

  it.each(PROBLEM_DIRS)("%s should publish the port on host loopback only", (dir) => {
    // The half that does restrict exposure. Asserted next to the bind so the pair is read
    // together: neither one alone is the contract.
    const compose = parseYaml(read(`${dir}/local/docker-compose.yml`)) as {
      services: Record<string, { ports?: string[]; network_mode?: string }>;
    };
    const services = Object.values(compose.services);
    const ports = services.flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping.startsWith("127.0.0.1:")).toBe(true);
    }
    // `network_mode: host` would make the container's loopback the host's, quietly changing
    // what both halves above mean.
    for (const service of services) {
      expect(service.network_mode).toBeUndefined();
    }
  });

  it.each(PROBLEM_DIRS)("%s should publish the port its metadata advertises", (dir) => {
    // A verifyUrl pointing at a port compose does not publish fails the same way as a bad
    // bind address: refused connection, no scoring, nothing in any log to explain it.
    const metadata = JSON.parse(read(`${dir}/metadata.json`)) as {
      runtime?: { verifyUrl?: string };
      exposedPorts?: Array<{ port: number }>;
    };
    const verifyUrl = metadata.runtime?.verifyUrl;
    if (verifyUrl === undefined) return;
    const url = new URL(verifyUrl);
    expect(url.hostname).toBe("127.0.0.1");

    const compose = parseYaml(read(`${dir}/local/docker-compose.yml`)) as {
      services: Record<string, { ports?: string[] }>;
    };
    const published = Object.values(compose.services)
      .flatMap((service) => service.ports ?? [])
      .map((mapping) => mapping.split(":")[1]);
    expect(published).toContain(url.port);
    expect(metadata.exposedPorts?.map((entry) => String(entry.port))).toContain(url.port);
  });
});

describe("the scaffolder hands out the reachable version", () => {
  // The template is the only file that matters for the next problem: a fix applied to 33
  // problems and not to the one they are copied from regenerates the bug on problem 34.
  const template = "challenges/ac26-bridge-experiment/local/verifier/server.py";

  it("should be the problem every other one is scaffolded from", () => {
    expect(VERIFIERS).toContain(template);
    expect(read("scripts/new-course-challenge.ts")).toContain("ac26-bridge-experiment");
  });

  it("should bind every interface in the template itself", () => {
    expect(read(template)).toMatch(WILDCARD_BIND);
  });

  it("should keep every verifier's bind line identical to the template's", () => {
    // Not a style rule. Divergence here means somebody edited one problem's networking by
    // hand, and this is the line where a hand edit is most likely to be wrong.
    const line = (source: string) =>
      source.split("\n").find((candidate) => candidate.includes("HTTPServer((")) ?? "";
    const expected = line(read(template));
    expect(expected).not.toBe("");
    for (const relative of VERIFIERS) {
      expect(line(read(relative))).toBe(expected);
    }
  });

  it("should name the problems it is checking, so the set is visible in the output", () => {
    // A guard whose subject list silently shrank would pass while covering less. This pins
    // that PROBLEM_DIRS and VERIFIERS describe the same problems.
    expect(VERIFIERS.map((relative) => basename(dirname(dirname(dirname(relative)))))).toEqual(
      PROBLEM_DIRS.map((dir) => basename(dir)),
    );
  });
});
