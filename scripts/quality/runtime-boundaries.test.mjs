import { describe, expect, it } from "vitest";
import { parseRuntimeDocument } from "./arch-engine/runtime-rules.mjs";
import {
	collectRuntimeCodingAgentIndependenceInput,
	collectRuntimeFailureContractInput,
	collectRuntimeSubagentsBoundaryInput,
	findRuntimeCodingAgentIndependenceViolations,
	findRuntimeFailureContractViolations,
	findRuntimeSubagentsBoundaryViolations,
	main,
	REQUIRED_RUNTIME_FAILURE_MARKERS,
	runRuntimeGuards,
} from "./check-runtime-boundaries.mjs";

function capture(run) {
	const lines = [];
	const errors = [];
	const log = console.log;
	const error = console.error;
	const exitCode = process.exitCode;
	console.log = (message) => lines.push(message);
	console.error = (message) => errors.push(message);
	try {
		return { code: run(), lines, errors };
	} finally {
		console.log = log;
		console.error = error;
		process.exitCode = exitCode;
	}
}

function fileGuard(name, label) {
	return [
		`  - name: ${name}`,
		`    label: ${label}`,
		'    summary: "boundary files={files}, violations=0"',
		"    input: files",
		"    scan:",
		"      kind: boundary",
		"      roots:",
		"        - apps/im-gateway/internal/router",
		"      extensions:",
		'        - ".go"',
		"      excludeSuffixes:",
		"        - _test.go",
		"      files:",
		"        - packages/runtime-core/src/errors.ts",
		"    patterns:",
		"      - label: blocks replay",
		"        source: replay",
	].join("\n");
}

describe("runtime boundary guard", () => {
	it("prints one result line for each boundary on the current tree", () => {
		const independence = collectRuntimeCodingAgentIndependenceInput();
		const subagents = collectRuntimeSubagentsBoundaryInput();
		const failure = collectRuntimeFailureContractInput();
		const { code, lines, errors } = capture(() => main());
		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(lines).toEqual([
			`[runtime-independence] ok (${independence.manifests.length} manifests, ${independence.files.length} code/config files, Coding Agent dependencies=0)`,
			`[runtime-subagents-boundary] ok (${subagents.files.length} source files, workspace dependencies=0, tool protocol tokens=0)`,
			`[runtime-failure-contract] ok (boundary files=${failure.length}, violations=0)`,
		]);
	});

	it("still reports the next boundary when one guard cannot read its files", () => {
		const document = parseRuntimeDocument(
			[
				"name: sample",
				"description: Sample runtime boundary.",
				"rationale: Keep the sample valid.",
				"examples: []",
				"guards:",
				fileGuard("broken", "runtime-independence"),
				fileGuard("later", "runtime-failure-contract"),
				"",
			].join("\n"),
		);
		const { code, lines, errors } = capture(() =>
			runRuntimeGuards(document.guards, (guard) => {
				if (guard.name === "broken") throw new Error("missing package.json");
				return [];
			}),
		);
		expect(code).toBe(1);
		expect(errors).toEqual(["[runtime-independence] internal error: missing package.json"]);
		expect(lines).toEqual(["[runtime-failure-contract] ok (boundary files=0, violations=0)"]);
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
