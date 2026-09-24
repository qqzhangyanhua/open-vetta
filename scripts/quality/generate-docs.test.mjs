import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGuardCheckPlan, referenceCheckOnly, main as runGuards } from "./check-guards.mjs";
import {
	extractGuardDoc,
	extractRuleDocument,
	loadQualityGatesSources,
	referenceRelativePath,
	renderQualityGatesReference,
	syncQualityGatesReference,
} from "./generate-docs.mjs";
import { repoRoot } from "./lib.mjs";

const fixture = {
	guards: [
		{
			file: "scripts/quality/check-demo.mjs",
			summary: "Fail when the demo imports an app.",
			detail: "Rules live in scripts/quality/rules/demo.yml.",
		},
		{ file: "scripts/quality/check-plain.mjs", summary: "", detail: "" },
	],
	documents: [
		{
			file: "scripts/quality/rules/demo.yml",
			name: "demo",
			description: "Keep demo packages independent.",
			rationale: "Core libraries stay below apps. See ADR-0042.",
			docs: ["ADR-0042", "docs/dev/quality-gates.md"],
			examples: [
				{
					violation: 'import { App } from "@vetta/desktop";',
					fix: 'import { Config } from "@vetta/config";',
				},
			],
			rules: [
				{
					name: "libs-must-not-depend-on-apps",
					description: "Libraries do not import apps.",
					type: "forbidden-import",
					fix: "Import a shared library instead of an application package.",
					docs: ["ADR-0042"],
					reports: ["libs/plugins must not import app package ({id})"],
				},
				{
					name: "extra-rule",
					description: "",
					type: "",
					fix: "",
					docs: ["ADR-0099"],
					reports: ["extra failed"],
				},
			],
		},
	],
	adrPaths: new Map([["0042", "docs/adr/0042-demo.md"]]),
};

const fixtureReference = `> 此文件自动生成，请勿手工编辑。

源头是 \`scripts/quality/check-*.mjs\` 的文件头 JSDoc，以及 \`scripts/quality/rules/*.yml\`。
本地 \`bun run check:guards\` 在守卫结束后重写这份文件。CI 只核对、不改文件；和源头不一致时该命令失败。也可以单独运行 \`bun run scripts/quality/generate-docs.mjs\`。

# 质量门禁参考

## 守卫

### \`scripts/quality/check-demo.mjs\`

Fail when the demo imports an app.

Rules live in scripts/quality/rules/demo.yml.

### \`scripts/quality/check-plain.mjs\`

（源文件没有文件头 JSDoc）

## 规则

### demo

配置：\`scripts/quality/rules/demo.yml\`

**描述**

Keep demo packages independent.

**理由**

Core libraries stay below apps. See [ADR-0042](../adr/0042-demo.md).

**相关文档**

- [ADR-0042](../adr/0042-demo.md)
- [docs/dev/quality-gates.md](./quality-gates.md)

**示例**

违规：

\`\`\`
import { App } from "@vetta/desktop";
\`\`\`

修复：

\`\`\`
import { Config } from "@vetta/config";
\`\`\`

**规则**

#### \`libs-must-not-depend-on-apps\`

Libraries do not import apps.

类型：forbidden-import

**相关文档**

- [ADR-0042](../adr/0042-demo.md)

修复建议：Import a shared library instead of an application package.

检查：

- libs/plugins must not import app package ({id})

#### \`extra-rule\`

**相关文档**

- ADR-0099

检查：

- extra failed
`;

describe("quality gate reference generation", () => {
	it("reads the guard summary from the leading JSDoc", () => {
		const text = `/**
 * Fail closed.
 *
 * Usage:
 *   bun run demo
 */

export const value = 1;
`;
		expect(extractGuardDoc("scripts/quality/check-demo.mjs", text)).toEqual({
			file: "scripts/quality/check-demo.mjs",
			summary: "Fail closed.",
			detail: "Usage:\n  bun run demo",
		});
	});

	it("reads rule name, rationale, example, and fix from YAML", () => {
		const text = `name: demo
description: Keep demo packages independent.
rationale: |
  See ADR-0042.
examples:
  - violation: |
      import { App } from "@vetta/desktop";
    fix: |
      import { Config } from "@vetta/config";
rules:
  - name: libs-must-not-depend-on-apps
    fix: Import a shared library.
    doc: ADR-0042
    imports:
      clauses:
        - report: libs/plugins must not import app package ({id})
`;
		expect(extractRuleDocument("scripts/quality/rules/demo.yml", text)).toMatchObject({
			name: "demo",
			description: "Keep demo packages independent.",
			rationale: "See ADR-0042.",
			examples: [
				{
					violation: 'import { App } from "@vetta/desktop";',
					fix: 'import { Config } from "@vetta/config";',
				},
			],
			rules: [
				{
					name: "libs-must-not-depend-on-apps",
					fix: "Import a shared library.",
					docs: ["ADR-0042"],
					reports: ["libs/plugins must not import app package ({id})"],
				},
			],
		});
	});

	it("reads fileReport and exportReport as the rule checks", () => {
		const text = `name: demo
description: Demo.
rationale: Because.
rules:
  - name: retired-layer-terminology
    steps:
      - op: retiredTerm
        fileReport: "{path}: implementation uses a retired architecture-layer term"
        exportReport: "{path}: export {export} uses a retired architecture-layer term"
`;
		expect(extractRuleDocument("scripts/quality/rules/demo.yml", text).rules[0]?.reports).toEqual([
			"{path}: implementation uses a retired architecture-layer term",
			"{path}: export {export} uses a retired architecture-layer term",
		]);
	});

	it("reads failure-contract marker text and pattern labels without the guard id", () => {
		const text = `name: demo
description: Demo.
rationale: Because.
guards:
  - name: failure-contract
    label: runtime-failure-contract
    summary: boundary files={files}, violations=0
    markers:
      missingFile: required runtime failure contract file is missing
      missingMarker: missing contract marker ({marker})
    patterns:
      - label: classifies recovery by JavaScript error message
        source: error.message.includes
`;
		const rule = extractRuleDocument("scripts/quality/rules/demo.yml", text).rules[0];
		expect(rule?.description).toBe("boundary files={files}, violations=0");
		expect(rule?.reports).toEqual([
			"required runtime failure contract file is missing",
			"missing contract marker ({marker})",
			"classifies recovery by JavaScript error message",
		]);
	});

	it("rejects YAML that does not parse", () => {
		expect(() => extractRuleDocument("scripts/quality/rules/bad.yml", "rules: [\n")).toThrow(
			/scripts\/quality\/rules\/bad\.yml/,
		);
	});

	it("renders the warning, ADR link, example, and fix", () => {
		expect(renderQualityGatesReference(fixture)).toBe(fixtureReference);
	});

	it("writes a stale reference and does not overwrite it in check mode", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-generate-docs-"));
		try {
			const first = syncQualityGatesReference({ root, sources: fixture });
			const target = join(root, referenceRelativePath);
			expect(first).toEqual({ changed: true, path: referenceRelativePath });
			expect(readFileSync(target, "utf8")).toBe(fixtureReference);
			expect(syncQualityGatesReference({ root, sources: fixture }).changed).toBe(false);

			writeFileSync(target, "stale\n");
			expect(syncQualityGatesReference({ root, sources: fixture, check: true })).toEqual({
				changed: true,
				path: referenceRelativePath,
			});
			expect(readFileSync(target, "utf8")).toBe("stale\n");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rewrites a stale reference after the guards pass", async () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-guard-docs-"));
		const target = join(root, referenceRelativePath);
		const lines = [];
		try {
			const code = await runGuards({
				root,
				sources: fixture,
				check: false,
				run: async () => 0,
				log: (line) => lines.push(line),
				error: (line) => lines.push(line),
			});
			expect(code).toBe(0);
			expect(readFileSync(target, "utf8")).toBe(fixtureReference);
			expect(lines).toEqual(["[generate-docs] wrote docs/dev/quality-gates-reference.md"]);

			const second = await runGuards({
				root,
				sources: fixture,
				check: false,
				run: async () => 0,
				log: (line) => lines.push(line),
				error: (line) => lines.push(line),
			});
			expect(second).toBe(0);
			expect(lines.at(-1)).toBe("[generate-docs] docs/dev/quality-gates-reference.md is up to date");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails in check mode when the reference is stale and does not write it", async () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-guard-docs-"));
		const target = join(root, referenceRelativePath);
		const lines = [];
		try {
			const code = await runGuards({
				root,
				sources: fixture,
				check: true,
				run: async () => 0,
				log: (line) => lines.push(line),
				error: (line) => lines.push(line),
			});
			expect(code).toBe(1);
			expect(existsSync(target)).toBe(false);
			expect(lines).toEqual([
				"[generate-docs] docs/dev/quality-gates-reference.md is stale. Run: bun run scripts/quality/generate-docs.mjs",
			]);

			syncQualityGatesReference({ root, sources: fixture });
			const second = await runGuards({
				root,
				sources: fixture,
				check: true,
				run: async () => 0,
				log: (line) => lines.push(line),
				error: (line) => lines.push(line),
			});
			expect(second).toBe(0);
			expect(readFileSync(target, "utf8")).toBe(fixtureReference);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rewrites the reference after a guard failure and still returns that failure", async () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-guard-docs-"));
		const order = [];
		try {
			const code = await runGuards({
				root,
				sources: fixture,
				check: false,
				run: async () => {
					order.push("guards");
					return 1;
				},
				log: (line) => order.push(line),
				error: (line) => order.push(line),
			});
			expect(order[0]).toBe("guards");
			expect(code).toBe(1);
			expect(readFileSync(join(root, referenceRelativePath), "utf8")).toBe(fixtureReference);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps CI from writing a stale reference when a guard already failed", async () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-guard-docs-"));
		try {
			const code = await runGuards({
				root,
				sources: fixture,
				check: true,
				run: async () => 1,
				log: () => {},
				error: () => {},
			});
			expect(code).toBe(1);
			expect(existsSync(join(root, referenceRelativePath))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

const liveRuleGuards = [
	"check-agent-ai-maintainability.mjs",
	"check-coding-agent-architecture.mjs",
	"check-conflict-markers.mjs",
	"check-conversation-message-architecture.mjs",
	"check-package-boundaries.mjs",
	"check-private-keys.mjs",
	"check-runtime-boundaries.mjs",
	"check-skill-frontmatter.mjs",
	"check-source-path-maps.mjs",
	"check-standalone-cli-build.mjs",
	"check-turbo-config.mjs",
	"check-vitest-runner.mjs",
];

describe("runtime boundary guard files", () => {
	it("rewrites the reference locally and only compares it in CI", () => {
		expect(referenceCheckOnly({})).toBe(false);
		expect(referenceCheckOnly({ CI: "false" })).toBe(false);
		expect(referenceCheckOnly({ CI: "true" })).toBe(true);
		expect(referenceCheckOnly({ CI: "1" })).toBe(true);
	});

	it("replaces the three runtime scripts with one YAML checker and twelve live rule guards", () => {
		const directory = join(repoRoot, "scripts/quality");
		const names = readdirSync(directory).filter((name) => name.startsWith("check-") && name.endsWith(".mjs"));
		const removed = [
			"check-runtime-coding-agent-independence.mjs",
			"check-runtime-failure-contract.mjs",
			"check-runtime-subagents-boundary.mjs",
		];
		for (const name of removed) expect(names).not.toContain(name);

		const excluded = new Set([
			"check-architecture.mjs",
			"check-fast.mjs",
			"check-guards.mjs",
			"check-lint.mjs",
			"check-quick.mjs",
			"check-coding-agent-architecture.legacy.mjs",
			"check-package-boundaries.legacy.mjs",
		]);
		expect(names.filter((name) => !excluded.has(name)).sort()).toEqual(liveRuleGuards);
		expect(createGuardCheckPlan().some((step) => step[1] === "scripts/quality/check-runtime-boundaries.mjs")).toBe(
			true,
		);
		expect(createGuardCheckPlan().some((step) => removed.some((name) => step[1]?.endsWith(name)))).toBe(false);
	});
});

describe("committed quality gate reference", () => {
	it("includes the live guard summary, rule fix, and ADR link", () => {
		const model = loadQualityGatesSources(repoRoot);
		const boundaries = model.documents.find((document) => document.name === "package-boundaries");
		const rule = boundaries?.rules.find((item) => item.name === "libs-must-not-depend-on-apps");
		const runtime = model.documents.find((document) => document.name === "runtime-boundaries");
		const rendered = renderQualityGatesReference(model);

		expect(rule?.fix).toBe("Import a shared library instead of an application package.");
		expect(rule?.reports).toContain("libs/plugins must not import app package ({id})");
		expect(boundaries?.examples[0]?.violation).toContain("@vetta/desktop");
		const failure = runtime?.rules.find((item) => item.name === "failure-contract");
		expect(runtime?.rules.map((item) => item.name)).toEqual([
			"coding-agent-independence",
			"subagents-boundary",
			"failure-contract",
		]);
		expect(failure?.reports).toEqual(
			expect.arrayContaining([
				"required runtime failure contract file is missing",
				"missing contract marker ({marker})",
				"classifies recovery by JavaScript error message",
			]),
		);
		expect(failure?.reports).not.toContain("runtime-failure-contract");
		expect(model.guards.some((guard) => guard.file.endsWith(".legacy.mjs"))).toBe(false);
		expect(model.guards.find((guard) => guard.file === "scripts/quality/check-private-keys.mjs")?.summary).toBe(
			"Fail if text outside docs and generated trees looks like a private key. The full scan and `check:quick` use the same set, including repo-root files and extensions such as `.pem`. Docs stay skipped so examples are not keys.",
		);
		expect(rendered.startsWith("> 此文件自动生成，请勿手工编辑")).toBe(true);
		expect(rendered).toContain("[ADR-0077](../adr/0077-agent-runtime-product-ownership.md)");
		expect(rendered).toMatch(
			/#### `retired-layer-terminology`\n\n\*\*相关文档\*\*\n\n- \[ADR-0077\]\(\.\.\/adr\/0077-agent-runtime-product-ownership\.md\)/,
		);
		expect(rendered).toContain("#### `libs-must-not-depend-on-apps`");
		expect(readFileSync(join(repoRoot, referenceRelativePath), "utf8")).toBe(rendered);
	});
});
