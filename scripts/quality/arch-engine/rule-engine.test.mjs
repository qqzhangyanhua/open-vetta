import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CheckViolation } from "../lib.mjs";
import {
	checkDocument,
	checkRule,
	loadRuleDirectory,
	loadRuleDocument,
	matchesGlobs,
	parseRuleDocument,
	RuleDocumentError,
} from "./rule-engine.mjs";

const rulesDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");

const LIB_RULE = {
	name: "libs-must-not-depend-on-apps",
	type: "forbidden-import",
	sources: ["packages/**", "!**/*.test.ts"],
	targets: ["apps/**", "@vetta/desktop", "@vetta/desktop/**"],
	message: "Core libraries must not depend on application packages",
};

function withRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "vetta-rule-engine-"));
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeRule(root, name, text) {
	const file = join(root, name);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	return file;
}

function ruleDocument(name, sources = '      - "packages/**"\n') {
	return [
		`name: ${name}`,
		"description: Dependency direction for one sample.",
		"rationale: Core libraries stay independent of application packages.",
		"examples: []",
		"rules:",
		"  - name: libs-must-not-depend-on-apps",
		"    type: forbidden-import",
		"    sources:",
		sources.trimEnd(),
		"    targets:",
		'      - "@vetta/desktop"',
		"    message: Core libraries must not depend on application packages",
		"",
	].join("\n");
}

describe("glob patterns", () => {
	it("matches a file path and an import specifier with *, **, and ?", () => {
		expect(matchesGlobs("packages/ai/src/index.ts", ["packages/**"])).toBe(true);
		expect(matchesGlobs("packages-extra/src/index.ts", ["packages/**"])).toBe(false);
		expect(matchesGlobs("apps/desktop", ["apps/**"])).toBe(true);
		expect(matchesGlobs("apps/desktop/src/main.ts", ["apps/**"])).toBe(true);
		expect(matchesGlobs("packages/runtime-node/src/index.ts", ["packages/runtime-*/**"])).toBe(true);
		expect(matchesGlobs("packages/ai/src/index.ts", ["packages/runtime-*/**"])).toBe(false);
		expect(matchesGlobs("packages/ai/src/index.ts", ["packages/**/index.ts"])).toBe(true);
		expect(matchesGlobs("packages/index.ts", ["packages/**/index.ts"])).toBe(true);
		expect(matchesGlobs("packages/index.js", ["packages/**/index.ts"])).toBe(false);
		expect(matchesGlobs("packages/ai/src/index.ts", ["packages/?i/**"])).toBe(true);
		expect(matchesGlobs("packages/abi/src/index.ts", ["packages/?i/**"])).toBe(false);
		expect(matchesGlobs("@vetta/desktop", ["@vetta/desktop/**"])).toBe(true);
		expect(matchesGlobs("@vetta/desktop/src/main", ["@vetta/desktop/**"])).toBe(true);
		expect(matchesGlobs("@vetta/desktop-extra", ["@vetta/desktop"])).toBe(false);
		expect(matchesGlobs("@vetta/agent", ["@vetta/*"])).toBe(true);
		expect(matchesGlobs("@vetta/agent/src", ["@vetta/*"])).toBe(false);
		expect(matchesGlobs("packages\\ai\\src\\index.ts", ["packages/**"])).toBe(true);
	});

	it("applies negated globs in order, so a later pattern can match again", () => {
		const production = ["**/*.ts", "!**/*.test.ts", "!**/test/**"];

		expect(matchesGlobs("packages/ai/src/index.ts", production)).toBe(true);
		expect(matchesGlobs("packages/ai/src/index.test.ts", production)).toBe(false);
		expect(matchesGlobs("packages/ai/test/helper.ts", production)).toBe(false);
		expect(matchesGlobs("packages/ai/src/index.js", production)).toBe(false);
		expect(matchesGlobs("packages/ai/src/index.test.ts", ["**/*.ts", "!**/*.test.ts", "packages/ai/**"])).toBe(true);
		expect(() => matchesGlobs("a.ts", [""])).toThrow(RuleDocumentError);
		expect(() => matchesGlobs("a.ts", ["!"])).toThrow(/invalid glob/);
	});
});

describe("forbidden-import", () => {
	it("reports the import, export, require, and dynamic import a library file would write", () => {
		const text = [
			'import type { Config } from "@vetta/desktop";',
			'export { screen } from "@vetta/desktop/screen";',
			'const lazy = import("apps/desktop/src/main");',
			'const fs = require("@vetta/desktop");',
			'import sync = require("apps/cli-host/src/index");',
			'import { Agent } from "@vetta/agent";',
			'// import { Desktop } from "apps/desktop";',
			'const sample = "import { Desktop } from \\"apps/desktop\\";";',
			'foo.require("apps/desktop");',
			"",
		].join("\n");

		expect(checkRule(LIB_RULE, [{ path: "packages/ai/src/index.ts", text }])).toEqual([
			new CheckViolation(
				"packages/ai/src/index.ts",
				1,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.ts",
				2,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.ts",
				3,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.ts",
				4,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.ts",
				5,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
		]);
	});

	it("skips files the source globs exclude, and keeps a JSX import", () => {
		const appImport = 'import { Desktop } from "@vetta/desktop";\n';
		const violations = checkRule(LIB_RULE, [
			{ path: "apps/desktop/src/main.ts", text: appImport },
			{ path: "packages/ai/src/index.test.ts", text: 'import { Desktop } from "apps/desktop";\n' },
			{ path: "packages\\ui\\view.tsx", text: `export const View = () => <Button />;\n${appImport}` },
		]);

		expect(violations).toEqual([
			new CheckViolation(
				"packages/ui/view.tsx",
				2,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
		]);
	});

	it("still sees a specifier written as a template, a type argument, or a type query", () => {
		const text = [
			"export { screen } from `@vetta/desktop`;",
			'const typed = import<string>("@vetta/desktop/screen");',
			'const wrapped = require(("apps/desktop"));',
			'type Desktop = import("@vetta/desktop").App;',
			'const name = "desktop";',
			"const dynamic = import(`@vetta/$" + "{name}`);",
			"",
		].join("\n");

		expect(
			checkRule(LIB_RULE, [{ path: "packages/ai/src/index.ts", text }]).map((violation) => violation.line),
		).toEqual([1, 2, 3, 4]);
	});

	it("ignores a dynamic import whose specifier is not a string literal", () => {
		expect(
			checkRule(LIB_RULE, [
				{ path: "packages/ai/src/index.ts", text: 'const name = "apps/desktop";\nimport(name);\n' },
			]),
		).toEqual([]);
	});

	it("rejects a rule type the engine does not run", () => {
		expect(() => checkRule({ ...LIB_RULE, type: "naming-convention" }, [])).toThrow(/forbidden-import/);
	});
});

describe("rule documents", () => {
	it("checks every rule in a document and keeps the message from the file", () => {
		const document = parseRuleDocument(ruleDocument("package-boundaries"), "package-boundaries.yml");
		const violations = checkDocument(document, [
			{ path: "packages/ai/src/index.ts", text: 'import { DesktopConfig } from "@vetta/desktop";\n' },
			{ path: "packages/ai/src/safe.ts", text: 'import { Agent } from "@vetta/agent";\n' },
		]);

		expect(document.description).toBe("Dependency direction for one sample.");
		expect(document.rationale).toBe("Core libraries stay independent of application packages.");
		expect(violations).toEqual([
			new CheckViolation(
				"packages/ai/src/index.ts",
				1,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
		]);
	});

	it("rejects a document that breaks the schema or hides a glob in an unquoted tag", () => {
		expect(() => parseRuleDocument("name: only\n", "bad.yml")).toThrow(RuleDocumentError);
		expect(() => parseRuleDocument("name: only\n", "bad.yml")).toThrow(/bad\.yml: description/);
		expect(() => parseRuleDocument("- just-a-list\n", "bad.yml")).toThrow(/mapping/);
		expect(() => parseRuleDocument(ruleDocument("sample").replace("description:", "summary:"), "bad.yml")).toThrow(
			/unknown field "summary"/,
		);
		expect(() =>
			parseRuleDocument(ruleDocument("sample").replace("forbidden-import", "naming-convention"), "bad.yml"),
		).toThrow(/forbidden-import/);
		expect(() => parseRuleDocument(ruleDocument("sample").replace('      - "packages/**"\n', ""), "bad.yml")).toThrow(
			/sources/,
		);

		const duplicated = ruleDocument("sample").replace(
			"    message: Core libraries must not depend on application packages\n",
			[
				"    message: Core libraries must not depend on application packages",
				"  - name: libs-must-not-depend-on-apps",
				"    type: forbidden-import",
				"    sources:",
				'      - "packages/**"',
				"    targets:",
				'      - "@vetta/desktop"',
				"    message: again",
				"",
			].join("\n"),
		);
		expect(() => parseRuleDocument(duplicated, "bad.yml")).toThrow(/duplicates/);

		const unquotedNegation = ruleDocument("sample").replace('      - "@vetta/desktop"', "      - !**/*.test.ts");
		expect(() => parseRuleDocument(unquotedNegation, "bad.yml")).toThrow(/Unresolved tag/);
	});

	it("loads the rules directory in name order and ignores files that are not yaml", () => {
		withRoot((root) => {
			writeRule(root, "b.yaml", ruleDocument("second"));
			writeRule(root, "a.yml", ruleDocument("first"));
			writeRule(root, "notes.md", "not a rule");

			expect(loadRuleDirectory(root).map((document) => document.name)).toEqual(["first", "second"]);
			expect(() => loadRuleDirectory(join(root, "missing"))).toThrow(/missing/);
		});
	});

	it("loads the package-boundaries rules and reports the sample violations", () => {
		const document = loadRuleDocument(join(rulesDirectory, "package-boundaries.yml"));
		const violations = checkDocument(document, [
			{
				path: "packages/ai/src/index.ts",
				text: 'import { DesktopConfig } from "@vetta/desktop";\nimport { fixture } from "../test/fixture";\n',
			},
			{
				path: "packages/ai/src/index.test.ts",
				text: 'import { DesktopConfig } from "@vetta/desktop";\nimport { fixture } from "../test/fixture";\n',
			},
			{
				path: "apps/desktop/src/main.ts",
				text: 'import { DesktopConfig } from "@vetta/desktop";\n',
			},
			{
				path: "packages/ai/src/load.js",
				text: 'import { fixture } from "../fixture.test.js";\n',
			},
			{
				path: "packages/ai/src/load.test.js",
				text: 'import { fixture } from "../fixture.test.js";\n',
			},
		]);

		expect(document.examples.map((example) => example.violation)).toEqual([
			expect.stringContaining('from "@vetta/desktop"'),
			expect.stringContaining("../test/fixture"),
		]);
		expect(violations).toEqual([
			new CheckViolation(
				"packages/ai/src/index.ts",
				1,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.test.ts",
				1,
				"libs-must-not-depend-on-apps",
				"Core libraries must not depend on application packages",
			),
			new CheckViolation(
				"packages/ai/src/index.ts",
				2,
				"no-test-imports-in-production",
				"Production code must not import test utilities",
			),
			new CheckViolation(
				"packages/ai/src/load.js",
				1,
				"no-test-imports-in-production",
				"Production code must not import test utilities",
			),
		]);
	});
});
