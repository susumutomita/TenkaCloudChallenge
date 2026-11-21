import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

/**
 * Static guarantees of the safety boundary. These fail the problem's own test
 * run if a change ever regresses them, so they do not rely on a reviewer.
 */

const local = new URL("../local/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, local), "utf8");

const phpSources = ["app/lib.php", "app/bin/bootstrap.php", "app/public/index.php"].map((rel) => [rel, read(rel)]);
const jsSources = readdirSync(new URL("verify/", local)).map((name) => [`verify/${name}`, read(`verify/${name}`)]);

test("the PHP app never executes programs, evaluates code or opens outbound connections", () => {
  const forbidden = /\b(exec|shell_exec|system|passthru|popen|proc_open|pcntl_exec|eval|curl_init|fsockopen|stream_socket_client|mail)\s*\(/;
  for (const [rel, src] of phpSources) assert.doesNotMatch(src, forbidden, rel);
  for (const [rel, src] of phpSources) assert.doesNotMatch(src, /\bchild_process\b|`[^`]*\$[^`]*`/, rel);
});

test("the verifier never spawns processes and only talks to the configured surface", () => {
  for (const [rel, src] of jsSources) {
    assert.doesNotMatch(src, /child_process|\beval\(|new Function\(/, rel);
  }
  assert.match(read("verify/server.mjs"), /process\.env\.SURFACE_URL \?\? "http:\/\/surface:8080"/);
});

test("the shipped images carry no flag, no seed and no default seed", () => {
  for (const [rel, src] of [...phpSources, ...jsSources, ["Dockerfile", read("Dockerfile")], ["docker-compose.yml", read("docker-compose.yml")]]) {
    assert.doesNotMatch(src, /TC\{[0-9a-z_]{8,}\}/i, `${rel} embeds a flag-shaped literal`);
    assert.doesNotMatch(src, /FLAG_SEED:-/, `${rel} gives FLAG_SEED a default`);
  }
});

test("Dockerfile pins an official php:8 image and the node image by digest and drops root in both stages", () => {
  const dockerfile = read("Dockerfile");
  const froms = dockerfile.split("\n").filter((l) => l.startsWith("FROM "));
  assert.equal(froms.length, 2);
  assert.match(froms[0], /^FROM php:8\.[0-9]+\.[0-9]+-cli-alpine@sha256:[0-9a-f]{64} AS surface$/);
  assert.match(froms[1], /^FROM node:[0-9.]+-alpine@sha256:[0-9a-f]{64} AS verifier$/);
  assert.match(dockerfile, /\nUSER www-data\n/);
  assert.match(dockerfile, /\nUSER node\n/);
  assert.doesNotMatch(dockerfile, /\nUSER root\n/);
});

test("compose binds to loopback only, requires FLAG_SEED, separates surface from verifier and hardens both", () => {
  const compose = parse(read("docker-compose.yml"));
  assert.deepEqual(Object.keys(compose.services).sort(), ["surface", "verifier"]);
  for (const [name, service] of Object.entries(compose.services)) {
    for (const port of service.ports) assert.match(String(port), /^127\.0\.0\.1:\d+:\d+$/, `${name} publishes off loopback`);
    assert.match(String(service.environment.FLAG_SEED), /^\$\{FLAG_SEED:\?/, `${name} does not require FLAG_SEED`);
    assert.equal(service.read_only, true, `${name} root filesystem is writable`);
    assert.deepEqual(service.cap_drop, ["ALL"], name);
    assert.ok(service.security_opt.includes("no-new-privileges:true"), name);
    assert.ok(service.healthcheck?.test?.length > 0, `${name} has no healthcheck`);
    assert.equal(service.privileged, undefined, name);
    assert.equal(service.volumes, undefined, `${name} mounts host paths`);
    assert.equal(service.network_mode, undefined, name);
  }
  assert.equal(compose.services.surface.build.target, "surface");
  assert.equal(compose.services.verifier.build.target, "verifier");
  assert.equal(compose.services.verifier.environment.SURFACE_URL, "http://surface:8080");
  assert.deepEqual(compose.services.surface.tmpfs.sort(), ["/app/private", "/app/state"]);
});
