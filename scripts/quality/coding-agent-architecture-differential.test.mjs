import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	evaluateCodingAgentArchitecture,
	loadCodingAgentDocument,
	parseCodingAgentDocument,
} from "./arch-engine/coding-agent-rules.mjs";
import {
	collectCodingAgentArchitectureState as collectLegacyState,
	findCodingAgentArchitectureViolations as findLegacyViolations,
	readCurrentInput as readLegacyInput,
} from "./check-coding-agent-architecture.legacy.mjs";
import {
	collectCodingAgentArchitectureState,
	findCodingAgentArchitectureViolations,
	formatCodingAgentArchitectureFailures,
	readCodingAgentArchitectureInput,
} from "./check-coding-agent-architecture.mjs";
import { repoRoot } from "./lib.mjs";

const documentPath = join(repoRoot, "scripts/quality/rules/coding-agent-architecture.yml");
const checkerPath = join(repoRoot, "scripts/quality/check-coding-agent-architecture.mjs");
const SOURCE_ROOT = "packages/coding-agent/src";

function packageJson(exports = {}) {
	return {
		exports: { ".": "./dist/index.js", "./composition": "./dist/composition/index.js", ...exports },
	};
}

function withFacade(extraFiles, exports) {
	return {
		files: [
			{ path: `${SOURCE_ROOT}/index.ts`, text: 'export * from "./public-api/extensions.js";' },
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export type { CodingAgentRuntimeComposition } from "./contracts/index.js";',
			},
			...extraFiles,
		],
		packageJson: packageJson(exports),
	};
}

function sameViolations(input) {
	const legacy = findLegacyViolations(collectLegacyState(input));
	const next = findCodingAgentArchitectureViolations(collectCodingAgentArchitectureState(input));
	expect(next).toEqual(legacy);
}

describe("coding agent architecture migration", () => {
	it("keeps the checker under 800 lines and cites the architecture documents", () => {
		const lines = readFileSync(checkerPath, "utf8").split("\n").length;
		expect(lines).toBeLessThan(800);
		const legacy = readFileSync(join(repoRoot, "scripts/quality/check-coding-agent-architecture.legacy.mjs"), "utf8");
		expect(legacy).toContain("@deprecated");
		const document = loadCodingAgentDocument(documentPath);
		expect(document.docs).toEqual(
			expect.arrayContaining(["ADR-0077", "docs/dev/quality-gates.md", "packages/coding-agent/AGENTS.md"]),
		);
		expect(document.rules.map((rule) => rule.name)).toContain("dependency-direction");
		expect(document.examples.map((example) => example.violation).join("\n")).toContain(
			"@vetta/coding-agent/src/private.js",
		);
		expect(() => parseCodingAgentDocument("name: only\n", "bad.yml")).toThrow(/description/);
	});

	it("puts the rule name, line, and architecture docs on a direct-run failure", () => {
		const document = loadCodingAgentDocument(documentPath);
		const contract = withFacade([
			{
				path: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
				text: 'export const ready = true;\nimport type { Value } from "../../adapters/runtime-core/adapter.js";\n',
			},
		]);
		const retired = withFacade([
			{ path: `${SOURCE_ROOT}/composition/runtime.ts`, text: 'export const retired = "RuntimeAgentHost";' },
		]);
		const contractFinding = evaluateCodingAgentArchitecture(
			document,
			collectCodingAgentArchitectureState(contract),
		).find((finding) => finding.message.includes("contract depends on implementation"));
		const retiredFinding = evaluateCodingAgentArchitecture(
			document,
			collectCodingAgentArchitectureState(retired),
		).find((finding) => finding.rule === "retired-multi-host-concepts");

		expect(contractFinding).toMatchObject({
			file: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
			line: 2,
			rule: "dependency-direction",
			doc: "ADR-0077",
		});
		expect(retiredFinding).toMatchObject({ line: 1, doc: "ADR-0077" });
		expect(formatCodingAgentArchitectureFailures([contractFinding], document)).toEqual([
			`[coding-agent-architecture] ${contractFinding.file}:2: ${contractFinding.message} (dependency-direction)`,
			"[coding-agent-architecture] see: ADR-0077; docs/dev/quality-gates.md; packages/coding-agent/AGENTS.md",
			"[coding-agent-architecture] 1 violation(s)",
		]);
	});

	it("matches the legacy checker on representative edits", () => {
		sameViolations(withFacade([]));
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
					text: 'import type { Value } from "../../adapters/runtime-core/adapter.js";',
				},
			]),
		);
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/memory/runtime.ts`,
					text: 'import { createRuntime } from "../composition/runtime-composition.js";',
				},
			]),
		);
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/sessions/legacy/reader.ts`,
					text: 'import { execute } from "../../execution/turn/turn-executor.js";',
				},
			]),
		);
		sameViolations(
			withFacade([
				{
					path: "apps/cli-host/src/runtime.ts",
					text: 'import { value } from "@vetta/coding-agent/src/private.js";',
				},
			]),
		);
		sameViolations(
			withFacade([
				{ path: `${SOURCE_ROOT}/composition/runtime.ts`, text: 'export const retired = "RuntimeAgentHost";' },
			]),
		);
		sameViolations(withFacade([{ path: `${SOURCE_ROOT}/core/agent.ts`, text: "export const value = 1;" }]));
		sameViolations(
			withFacade([{ path: `${SOURCE_ROOT}/concurrency/index.ts`, text: "export function createLimiter() {}" }]),
		);
		sameViolations(withFacade([], { "./concurrency": "./dist/concurrency/index.js" }));
		const retiredTerm = ["pro", "duct"].join("");
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/model-context/${retiredTerm}-prompt.ts`,
					text: `export type ${retiredTerm}Policy = {};`,
				},
			]),
		);
		sameViolations(withFacade([], { [`./${retiredTerm}-prompt`]: "./dist/prompt.js" }));
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
					text: 'import { readFile } from "node:fs";',
				},
			]),
		);
		sameViolations(
			withFacade([
				{
					path: `${SOURCE_ROOT}/index.ts`,
					text: 'import { value } from "./memory/runtime.js";',
				},
			]),
		);
	});

	it("matches the legacy checker on the files the guard scans", () => {
		const legacyInput = readLegacyInput();
		const nextInput = readCodingAgentArchitectureInput();
		expect(nextInput.files.map((file) => file.path)).toEqual(legacyInput.files.map((file) => file.path));
		expect(Object.keys(nextInput.packageJson.exports ?? {}).sort()).toEqual(
			Object.keys(legacyInput.packageJson.exports ?? {}).sort(),
		);
		const legacyState = collectLegacyState(legacyInput);
		const nextState = collectCodingAgentArchitectureState(legacyInput);
		expect(nextState.edges).toEqual(legacyState.edges);
		expect(nextState.sourcePaths).toEqual(legacyState.sourcePaths);
		expect(findCodingAgentArchitectureViolations(legacyState)).toEqual(findLegacyViolations(legacyState));
	}, 120_000);
});
