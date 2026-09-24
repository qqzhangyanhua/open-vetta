import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRuntimeDocument, parseRuntimeDocument, RuntimeDocumentError } from "./runtime-rules.mjs";

const rulesDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");

describe("runtime boundary document", () => {
	it("loads the three runtime guards from YAML", () => {
		const document = loadRuntimeDocument(join(rulesDirectory, "runtime-boundaries.yml"));
		expect(document.guards.map((guard) => guard.name)).toEqual([
			"coding-agent-independence",
			"subagents-boundary",
			"failure-contract",
		]);
		expect(document.guards.map((guard) => guard.label)).toEqual([
			"runtime-independence",
			"runtime-subagents-boundary",
			"runtime-failure-contract",
		]);
	});

	it("rejects an unknown field", () => {
		const text = readFileSync(join(rulesDirectory, "runtime-boundaries.yml"), "utf8");
		expect(() => parseRuntimeDocument(`${text}\nextra: 1\n`)).toThrow(RuntimeDocumentError);
	});

	it("rejects package rules on a file scan", () => {
		const text = [
			"name: sample",
			"description: Sample runtime boundary.",
			"rationale: Keep the sample valid.",
			"examples: []",
			"guards:",
			"  - name: sample-files",
			"    label: sample",
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
			"    manifests:",
			"      sections:",
			"        - dependencies",
			'      key: "@vetta/coding-agent"',
			'      report: "{section} must not declare @vetta/coding-agent"',
			"",
		].join("\n");
		expect(() => parseRuntimeDocument(text)).toThrow(/cannot declare package rules/);
	});

	it("rejects a pattern that is not a regular expression", () => {
		const text = [
			"name: sample",
			"description: Sample runtime boundary.",
			"rationale: Keep the sample valid.",
			"examples: []",
			"guards:",
			"  - name: sample-files",
			"    label: sample",
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
			"      - label: broken",
			"        source: '('",
			"",
		].join("\n");
		expect(() => parseRuntimeDocument(text)).toThrow(/not a valid regular expression/);
	});
});
