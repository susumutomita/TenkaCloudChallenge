import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "challenges", "ai-riscv-soc-repair");
const GOLDEN = join(
	import.meta.dir,
	"fixtures",
	"ai-riscv-soc-repair",
	"rv32i_cpu.sv",
);

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("ai-riscv-soc-repair catalog contract", () => {
	it("should ship the Level 1 authoring and local-play artifacts", () => {
		for (const file of [
			"metadata.json",
			"README.md",
			"README.ja.md",
			"Makefile",
			"local/Dockerfile",
			"local/docker-compose.yml",
			"local/Makefile",
			"local/firmware/boot.S",
			"local/firmware/link.ld",
			"local/rtl/rv32i_soc.sv",
			"local/solution/rv32i_cpu.sv",
			"local/tests/tb_soc.sv",
			"local/tests/test_server.py",
			"local/tools/generate_flag.py",
			"local/tools/server.py",
			"artifacts/ai-design-log.md",
			"artifacts/architecture.md",
			"artifacts/memory-map.md",
			"artifacts/toolchain.md",
		]) {
			expect(existsSync(join(ROOT, file)), file).toBe(true);
		}
		expect(existsSync(GOLDEN), "maintainer-only golden fixture").toBe(true);
	});

	it("should register a loopback Docker challenge with delegated verification", () => {
		const metadata = JSON.parse(read("metadata.json"));
		expect(metadata.id).toBe("ai-riscv-soc-repair");
		expect(metadata.category).toBe("Challenge");
		expect(metadata.runtime).toEqual({
			provider: "docker",
			engine: "compose",
			entry: "local/docker-compose.yml",
			challengeEndpoints: { Lab: "http://127.0.0.1:18080" },
			verifyUrl: "http://127.0.0.1:18081/verify",
			secretEnv: ["FLAG_SEED"],
		});
		expect(metadata.scoring.kind).toBe("verify");
		expect(metadata.i18n.en.instructions).toContain("make test");
		expect(metadata.writeup).toContain("JAL");
		expect(metadata.i18n.en.writeup).toContain("JAL");
	});

	it("should prove the intended red-to-green path without weakening the participant test", () => {
		const rootMakefile = read("Makefile");
		const labMakefile = read("local/Makefile");
		expect(rootMakefile).toContain("docker compose");
		expect(rootMakefile).toContain("reference-test");
		expect(rootMakefile).toContain("scripts/fixtures/ai-riscv-soc-repair");
		expect(labMakefile).toContain("CPU_SOURCE ?= solution/rv32i_cpu.sv");
		expect(labMakefile).toContain("riscv64-unknown-elf-gcc");
		expect(labMakefile).toContain("verilator");
		expect(labMakefile).toContain("--trace");
		expect(labMakefile).toContain("wave:");
		expect(labMakefile).toContain("python3 -m unittest");
	});

	it("should keep exactly three repair points different from the golden CPU", () => {
		const broken = read("local/solution/rv32i_cpu.sv");
		const reference = readFileSync(GOLDEN, "utf8");
		expect(broken).not.toBe(reference);
		expect(broken).toContain(".RESET_VECTOR(32'h0000_0004)");
		expect(reference).toContain(".RESET_VECTOR(32'h0000_0000)");
		expect(broken).toContain(".JAL_LINK_OFFSET(32'd8)");
		expect(reference).toContain(".JAL_LINK_OFFSET(32'd4)");
		expect(broken).toContain(".LB_SIGN_EXTEND(1'b0)");
		expect(reference).toContain(".LB_SIGN_EXTEND(1'b1)");
	});

	it("should bind every published port to loopback and live-mount only the repair file", () => {
		const compose = read("local/docker-compose.yml");
		expect(compose).toContain('"127.0.0.1:18080:8080"');
		expect(compose).toContain('"127.0.0.1:18081:8081"');
		expect(compose).toContain("./solution:/workspace/solution:ro");
		expect(compose).not.toContain("privileged:");
		expect(compose).not.toContain("network_mode: host");
		expect(compose).toContain('cpus: "2.0"');
		expect(compose).toContain('mem_limit: "2g"');
		expect(compose).toContain("pids_limit: 256");
		expect(compose).toContain(
			"/workspace/build:rw,exec,size=512m,uid=10001,gid=10001",
		);
		const dockerfile = read("local/Dockerfile");
		expect(dockerfile).not.toContain("reference");
		expect(dockerfile).toContain("debian:bookworm-slim@sha256:");
		expect(dockerfile).toContain("USER lab");
		expect(dockerfile).toContain("VERILATOR_VERSION=5.006");
	});
});
