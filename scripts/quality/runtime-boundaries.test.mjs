import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	collectRuntimeCodingAgentIndependenceInput,
	collectRuntimeFailureContractInput,
	collectRuntimeSubagentsBoundaryInput,
	findRuntimeCodingAgentIndependenceViolations,
	findRuntimeFailureContractViolations,
	findRuntimeSubagentsBoundaryViolations,
	REQUIRED_RUNTIME_FAILURE_MARKERS,
} from "./check-runtime-boundaries.mjs";
import { repoRoot } from "./lib.mjs";

describe("runtime boundary guard", () => {
	it("keeps the guard runner on the YAML checker", () => {
		const runner = readFileSync(join(repoRoot, "scripts/quality/check-guards.mjs"), "utf8");
		expect(runner).toContain('["run", "scripts/quality/check-runtime-boundaries.mjs"]');
		expect(runner).not.toContain("check-runtime-coding-agent-independence.mjs");
		expect(runner).not.toContain("check-runtime-subagents-boundary.mjs");
		expect(runner).not.toContain("check-runtime-failure-contract.mjs");
	});

	it("accepts the current Runtime packages", () => {
		const input = collectRuntimeCodingAgentIndependenceInput();
		expect(input.manifests.map((manifest) => manifest.path)).toEqual([
			"packages/runtime-core/package.json",
			"packages/runtime-knowledge/package.json",
			"packages/runtime-mcp/package.json",
			"packages/runtime-storage/package.json",
			"packages/runtime-subagents/package.json",
			"packages/runtime-telemetry/package.json",
			"packages/runtime-tools/package.json",
		]);
		expect(input.files.length).toBeGreaterThan(0);
		expect(findRuntimeCodingAgentIndependenceViolations(input)).toEqual([]);
	});

	it("accepts the current subagent kernel", () => {
		const input = collectRuntimeSubagentsBoundaryInput();
		expect(input.files.map((file) => file.path)).toEqual(
			expect.arrayContaining([
				"packages/runtime-subagents/src/subagent-dispatcher.ts",
				"packages/runtime-subagents/src/subagent-pool.ts",
				"packages/runtime-subagents/src/subagent-run.ts",
				"packages/runtime-subagents/src/recovery.ts",
			]),
		);
		expect(input.files.some((file) => file.path.endsWith("/scheduler.ts"))).toBe(false);
		expect(findRuntimeSubagentsBoundaryViolations(input)).toEqual([]);
	});

	it("accepts the current failure contract and skips test files", () => {
		const files = collectRuntimeFailureContractInput();
		for (const path of Object.keys(REQUIRED_RUNTIME_FAILURE_MARKERS)) {
			expect(files.some((file) => file.path === path)).toBe(true);
		}
		expect(files.some((file) => file.path.endsWith("_test.go") || file.path.endsWith(".test.ts"))).toBe(false);
		expect(findRuntimeFailureContractViolations(files)).toEqual([]);
	});
});
