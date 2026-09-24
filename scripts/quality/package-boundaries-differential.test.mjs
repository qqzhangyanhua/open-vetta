import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoundaryDocument } from "./arch-engine/boundary-rules.mjs";
import {
	findPackageBoundaryViolations as findLegacyPackageBoundaryViolations,
	findPackageManifestBoundaryViolations as findLegacyPackageManifestBoundaryViolations,
} from "./check-package-boundaries.legacy.mjs";
import { findPackageBoundaryViolations, findPackageManifestBoundaryViolations } from "./check-package-boundaries.mjs";
import { readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const documentPath = join(repoRoot, "scripts/quality/rules/package-boundaries.yml");
const checkerPath = join(repoRoot, "scripts/quality/check-package-boundaries.mjs");

function sameFindings(path, source, options) {
	expect(findPackageBoundaryViolations(path, source, options)).toEqual(
		findLegacyPackageBoundaryViolations(path, source, options),
	);
}

describe("package boundary migration", () => {
	it("keeps the checker smaller than 800 lines and loads the YAML rules", () => {
		const lines = readFileSync(checkerPath, "utf8").split("\n").length;
		expect(lines).toBeLessThan(800);
		const document = loadBoundaryDocument(documentPath);
		expect(document.rules.map((rule) => rule.name)).toEqual(
			expect.arrayContaining(["libs-must-not-depend-on-apps", "no-test-imports-in-production"]),
		);
		expect(document.examples.map((example) => example.violation).join("\n")).toContain("@vetta/desktop");
	});

	it("matches the legacy checker on representative edits", () => {
		const cases = [
			["packages/ai/src/example.ts", 'import "@vetta/desktop";'],
			["packages/ai/src/example.ts", 'const app = await import("@vetta/cli-host/runtime");'],
			["packages/ai/src/example.ts", '// import app from "@vetta/desktop";'],
			["packages/ai/src/example.ts", 'import { fixture } from "../../agent/test/fixture";'],
			["packages/ai/src/example.test.ts", 'import { fixture } from "../../agent/test/fixture";'],
			["packages/capability-sdk/src/adapters/example.ts", 'const id = "cap.domain.vetta.example.read";'],
			["packages/plugins/externals/example/src/index.ts", "window.vetta.fs.readFile(path);"],
			["packages/plugins/presets/plugin-workbench/src/index.ts", "window.vetta.fs.readFile(path);"],
			["apps/desktop/src/renderer/chat.ts", 'import { selectMcpMediaCandidates } from "@vetta/runtime-mcp";'],
			["apps/desktop/src/renderer/chat.ts", 'import type { McpToolCallResult } from "@vetta/runtime-mcp";'],
			["packages/runtime-core/src/kernel/bytes.ts", 'export const size = Buffer.byteLength("value");'],
			["packages/agent/src/telemetry.ts", 'import type { RuntimeTracer } from "@vetta/runtime-telemetry";'],
			["apps/desktop/src/main/new-consumer.ts", 'import { getAgentDir } from "@vetta/coding-agent";'],
			[
				"apps/desktop/src/main/new-consumer.ts",
				'import { getAgentDir } from "@vetta/coding-agent";\nimport { other } from "@vetta/coding-agent";',
			],
			[
				"packages/capability-sdk/src/example.ts",
				'import { runtime } from "@vetta/capability-runtime";\nimport { desktop } from "@vetta/desktop";',
			],
			[
				"packages/coding-agent/src/index.ts",
				'export { createReadTool, readTool } from "@vetta/runtime-tools/coding";',
			],
			[
				"packages/coding-agent/src/composition/runtime-composition.ts",
				'const runtime = new CodingAgentSubagentRuntime({});\nconst directory = ".subagents";',
			],
			[
				"packages/coding-agent/src/composition/tool-surface/runtime-tools-composition.ts",
				"interface CodingToolsRuntimeComposition { readonly registry: InMemoryCodingToolRegistry; }",
			],
			["apps/cli-host/vitest.config.ts", 'const alias = { "@vetta/coding-agent/runtime-host": "./retired" };'],
			[
				"packages/coding-agent/src/sessions/legacy/catalog.ts",
				'import { createAgentSession } from "../../../core/sdk.js";',
			],
		];
		for (const [path, source] of cases) sameFindings(path, source);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./runtime-host": "./dist/adapters/runtime-core/index.js" },
			}),
		).toEqual(
			findLegacyPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./runtime-host": "./dist/adapters/runtime-core/index.js" },
			}),
		);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/runtime-telemetry": "workspace:*" },
			}),
		).toEqual(
			findLegacyPackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/runtime-telemetry": "workspace:*" },
			}),
		);
	});

	it("matches the legacy checker on the files the guard scans", () => {
		const document = loadBoundaryDocument(documentPath);
		for (const entry of document.scan.entryPaths) {
			const text = readText(join(repoRoot, entry));
			sameFindings(entry, text);
		}
		for (const root of document.scan.roots) {
			let manifest;
			try {
				manifest = JSON.parse(readText(join(repoRoot, root, "package.json")));
			} catch {
				manifest = undefined;
			}
			expect(findPackageManifestBoundaryViolations(manifest)).toEqual(
				findLegacyPackageManifestBoundaryViolations(manifest),
			);
			for (const file of walkFiles(join(repoRoot, root))) {
				const posixPath = rel(file);
				if (document.scan.skipContains.some((part) => posixPath.includes(part))) continue;
				let text;
				try {
					text = readText(file);
				} catch {
					continue;
				}
				sameFindings(posixPath, text, { manifest });
			}
		}
	}, 120_000);
});
