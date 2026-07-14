import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "challenges", "ai-riscv-screen-repair");
const GOLDEN = join(
	import.meta.dir,
	"fixtures",
	"ai-riscv-screen-repair",
	"video_controller.sv",
);

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("ai-riscv-screen-repair catalog contract", () => {
	it("should ship the Level 2 specification before its RTL and local-play artifacts", () => {
		for (const file of [
			"metadata.json",
			"README.md",
			"README.ja.md",
			"Makefile",
			"diagram.svg",
			"artifacts/ai-design-log.md",
			"artifacts/architecture.md",
			"artifacts/memory-map.md",
			"artifacts/toolchain.md",
			"artifacts/verification-boundary.md",
			"local/Dockerfile",
			"local/docker-compose.yml",
			"local/Makefile",
			"local/firmware/pattern.S",
			"local/firmware/link.ld",
			"local/rtl/rv32i_cpu_core.sv",
			"local/rtl/rv32i_cpu.sv",
			"local/rtl/riscv_screen_soc.sv",
			"local/rtl/video_controller_core.sv",
			"local/solution/video_controller.sv",
			"local/tests/tb_screen.sv",
			"local/tests/test_server.py",
			"local/tools/server.py",
		]) {
			expect(existsSync(join(ROOT, file)), file).toBe(true);
		}
		expect(existsSync(GOLDEN), "maintainer-only golden fixture").toBe(true);
	});

	it("should define timing, registers, reset order, and CDC before implementation", () => {
		const architecture = read("artifacts/architecture.md");
		const memoryMap = read("artifacts/memory-map.md");
		expect(architecture).toContain("16 × 12");
		expect(architecture).toContain("22 pixel clocks");
		expect(architecture).toContain("16 lines");
		expect(architecture).toContain("asynchronous assert, synchronous deassert");
		expect(architecture).toContain("two-flop synchronizer");
		expect(architecture).toContain("request/acknowledge toggle");
		expect(memoryMap).toContain("`0x10001000`");
		expect(memoryMap).toContain("`0x10002000`–`0x100020bf`");
	});

	it("should register a loopback Docker challenge with state-based delegated verification", () => {
		const metadata = JSON.parse(read("metadata.json"));
		expect(metadata.id).toBe("ai-riscv-screen-repair");
		expect(metadata.category).toBe("Challenge");
		expect(metadata.runtime).toEqual({
			provider: "docker",
			engine: "compose",
			entry: "local/docker-compose.yml",
			challengeEndpoints: { Lab: "http://127.0.0.1:18200" },
			verifyUrl: "http://127.0.0.1:18201/verify",
		});
		expect(metadata.scoring.kind).toBe("verify");
		expect(metadata.instructions).toContain("make test");
		expect(metadata.i18n.en.instructions).toContain("make test");
		expect(metadata.writeup).toContain("CDC");
		expect(metadata.i18n.en.writeup).toContain("CDC");
	});

	it("should prove all three defect classes red before the golden design passes", () => {
		const rootMakefile = read("Makefile");
		const labMakefile = read("local/Makefile");
		const testbench = read("local/tests/tb_screen.sv");
		expect(rootMakefile).toContain("reference-test");
		expect(rootMakefile).toContain("scripts/fixtures/ai-riscv-screen-repair");
		expect(rootMakefile).toContain("expected all three inherited defect assertions");
		expect(labMakefile).toContain("VIDEO_SOURCE ?= solution/video_controller.sv");
		expect(labMakefile).toContain("riscv64-unknown-elf-gcc");
		expect(labMakefile).toContain("verilator");
		expect(labMakefile).toContain("frame.ppm");
		expect(testbench).toContain("CDC_ASSERT_FAIL");
		expect(testbench).toContain("TIMING_ASSERT_FAIL");
		expect(testbench).toContain("WRITE_STROBE_ASSERT_FAIL");
		expect(testbench).toContain("SIM_PASS");
	});

	it("should keep only the intended repair decisions different from the golden wrapper", () => {
		const broken = read("local/solution/video_controller.sv");
		const reference = readFileSync(GOLDEN, "utf8");
		expect(broken).not.toBe(reference);
		expect(broken).toContain(".CDC_SYNC_STAGES(1)");
		expect(reference).toContain(".CDC_SYNC_STAGES(2)");
		expect(broken).toContain(".H_TOTAL_ADJUST(-1)");
		expect(reference).toContain(".H_TOTAL_ADJUST(0)");
		expect(broken).toContain(".V_TOTAL_ADJUST(-1)");
		expect(reference).toContain(".V_TOTAL_ADJUST(0)");
		expect(broken).toContain(".RESPECT_WRITE_STROBES(1'b0)");
		expect(reference).toContain(".RESPECT_WRITE_STROBES(1'b1)");
	});

	it("should publish loopback ports without opening lab egress and mount only participant RTL", () => {
		const compose = read("local/docker-compose.yml");
		expect(compose).toContain('"127.0.0.1:18200:8080"');
		expect(compose).toContain('"127.0.0.1:18201:8081"');
		expect(compose).toContain("./solution:/workspace/solution:ro");
		expect(compose).not.toContain("privileged:");
		expect(compose).not.toContain("network_mode: host");
		expect(compose).toContain('cpus: "2.0"');
		expect(compose).toContain('mem_limit: "2g"');
		expect(compose).toContain("pids_limit: 256");
		expect(compose).toContain("read_only: true");
		expect(compose).toContain("no-new-privileges:true");
		expect(compose).toContain("cap_drop:");
		expect(compose).toContain("- workshop-host");
		expect(compose).toContain("internal: true");
		expect(compose).toContain(
			'com.docker.network.bridge.enable_ip_masquerade: "false"',
		);
		expect(compose).toContain(
			'com.docker.network.bridge.host_binding_ipv4: "127.0.0.1"',
		);
		const dockerfile = read("local/Dockerfile");
		expect(dockerfile).not.toContain("reference");
		expect(dockerfile).toContain("debian:bookworm-slim@sha256:");
		expect(dockerfile).toContain("USER lab");
		expect(dockerfile).toContain("VERILATOR_VERSION=5.006");
	});
});
