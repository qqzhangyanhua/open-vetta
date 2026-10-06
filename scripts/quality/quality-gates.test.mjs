import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluateBoundaryFile, loadBoundaryDocument } from "./arch-engine/boundary-rules.mjs";
import { mergeBoundaryItems, partitionBoundaryJobs } from "./arch-engine/boundary-scan.mjs";
import { createAstCache } from "./arch-engine/cache.mjs";
import { collectCodingAgentArchitectureState } from "./arch-engine/coding-agent-rules.mjs";
import { createArchitectureCheckPlan } from "./check-architecture.mjs";
import {
	checkConflictMarkers,
	findConflictMarkerViolationsInText,
	listConflictMarkerTargets,
	selectConflictMarkerFiles,
} from "./check-conflict-markers.mjs";
import { createFastCheckPlan } from "./check-fast.mjs";
import { createQuickGuardPlan } from "./check-guards.mjs";
import {
	boundaryWorkerCount,
	collectBoundaryScan,
	evaluateBoundaryFileJobs,
	findDurablePackageBoundaryViolations,
	findDurablePackageManifestBoundaryViolations,
	findPackageBoundaryViolations,
} from "./check-package-boundaries.mjs";
import {
	checkPrivateKeys,
	findPrivateKeyViolationsInText,
	listPrivateKeyTargets,
	selectPrivateKeyFiles,
} from "./check-private-keys.mjs";
import { batchPaths, createQuickCheckPlan, isBiomeGlobalTrigger, runChangedFileGuards } from "./check-quick.mjs";
import {
	checkSkillFrontmatter,
	findSkillFrontmatterProblems,
	findSkillFrontmatterViolations,
} from "./check-skill-frontmatter.mjs";
import {
	collectTypeScriptExportEntries,
	findImportedSourcePathMapViolations,
	findSourcePathMapViolations,
	typesExportToSourceRel,
} from "./check-source-path-maps.mjs";
import { findStandaloneCliBuildViolations } from "./check-standalone-cli-build.mjs";
import { findTurboConfigurationProblems, readTurboConfiguration } from "./check-turbo-config.mjs";
import { findVitestRunnerViolations } from "./check-vitest-runner.mjs";
import {
	buildableTestDependencies,
	CheckViolation,
	changedFiles,
	discoverWorkspacePackages,
	expandTestablePackages,
	formatElapsedTime,
	getWorkspacesBySpecificity,
	normalizeRepoPath,
	packagesFromPaths,
	parseBaseArgs,
	parseFileSelectionArgs,
	repoRoot,
	runCheck,
	stagedFiles,
	TESTABLE_PACKAGES,
	WORKSPACE_PACKAGES,
	workspaceForFile,
} from "./lib.mjs";
import { changedLockfileWorkspaceImpacts, changedLockfileWorkspaceKeys } from "./lockfile-impact.mjs";
import { createChangedTestPlan, parseArgs } from "./test-changed.mjs";
import { createImpactTestPlan, parseImpactArgs, relatedResultAction, runCapturedBun } from "./test-impact.mjs";

function canCreateSymlink() {
	const directory = mkdtempSync(join(tmpdir(), "vetta-symlink-probe-"));
	try {
		symlinkSync(directory, join(directory, "link"), "dir");
		return true;
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
		if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return false;
		throw error;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("changed file selection", () => {
	it("combines committed, working tree, and untracked paths", () => {
		const outputs = new Map([
			[["merge-base", "HEAD", "origin/dev"].join("\0"), "base-sha"],
			[["diff", "--name-only", "-z", "base-sha...HEAD"].join("\0"), "packages/ai/src/a.ts\0"],
			[["diff", "--name-only", "-z", "HEAD"].join("\0"), "packages/agent/src/b.ts\0"],
			[
				["ls-files", "--others", "--exclude-standard", "-z"].join("\0"),
				"packages/ecosystem-adapter/src/new.ts\0packages/ai/src/a.ts\0",
			],
		]);
		const git = (args) => outputs.get(args.join("\0")) ?? "";

		expect(changedFiles("origin/dev", git)).toEqual(
			["packages/agent/src/b.ts", "packages/ai/src/a.ts", "packages/ecosystem-adapter/src/new.ts"].sort(),
		);
	});

	it("preserves unusual paths from NUL-delimited Git output", () => {
		const outputs = new Map([
			[["merge-base", "HEAD", "origin/dev"].join("\0"), "base-sha"],
			[["diff", "--name-only", "-z", "base-sha...HEAD"].join("\0"), "packages/ai/src/line\nbreak.ts\0"],
			[["diff", "--name-only", "-z", "HEAD"].join("\0"), "packages/ai/src/a & b.ts\0"],
			[["ls-files", "--others", "--exclude-standard", "-z"].join("\0"), ""],
		]);
		const git = (args) => outputs.get(args.join("\0")) ?? "";

		expect(changedFiles("origin/dev", git)).toEqual(
			["packages/ai/src/a & b.ts", "packages/ai/src/line\nbreak.ts"].sort(),
		);
	});

	it("preserves unusual staged paths", () => {
		const git = () => "packages/ai/src/a & b.ts\0packages/ai/src/line\nbreak.ts\0";
		expect(stagedFiles(git)).toEqual(["packages/ai/src/a & b.ts", "packages/ai/src/line\nbreak.ts"]);
	});

	it("does not hide an invalid base ref", () => {
		const git = () => {
			throw new Error("missing base");
		};
		expect(() => changedFiles("missing", git)).toThrow("missing base");
	});

	it("normalizes Windows package paths", () => {
		expect(packagesFromPaths(["packages\\ai\\src\\index.ts"])).toEqual(["ai"]);
	});

	it("validates base arguments shared by changed-file commands", () => {
		expect(parseBaseArgs(["--base", "origin/main"])).toEqual({ base: "origin/main" });
		expect(() => parseBaseArgs(["--base", "--unknown"])).toThrow("--base requires a git ref");
		expect(() => parseBaseArgs(["--unknown"])).toThrow("unknown argument");
	});

	it("accepts explicit task files and rejects paths outside the repository", () => {
		expect(parseFileSelectionArgs(["--base=origin/main", "packages\\ai\\src\\index.ts"])).toEqual({
			base: "origin/main",
			files: ["packages/ai/src/index.ts"],
		});
		expect(() => parseFileSelectionArgs(["../outside.ts"])).toThrow("inside the repository");
		expect(() => parseFileSelectionArgs(["..\\outside.ts"])).toThrow("inside the repository");
	});

	it("rejects path traversal outside the repository", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-repo-path-"));
		try {
			expect(() => normalizeRepoPath("../../etc/passwd", root)).toThrow("inside the repository");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("normalizes Windows separators to forward slashes", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-repo-path-"));
		try {
			expect(normalizeRepoPath("packages\\ai\\src\\index.ts", root)).toBe("packages/ai/src/index.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a lexical path when a middle component is a file", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-repo-path-"));
		try {
			writeFileSync(join(root, "file.txt"), "text\n");
			expect(normalizeRepoPath("file.txt/child.ts", root)).toBe("file.txt/child.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.skipIf(!canCreateSymlink())("keeps an in-repo symlink and rejects one that resolves outside", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-repo-path-"));
		const outside = mkdtempSync(join(tmpdir(), "vetta-repo-outside-"));
		try {
			mkdirSync(join(root, "packages"));
			writeFileSync(join(root, "packages", "real.ts"), "export {}\n");
			symlinkSync(join(root, "packages", "real.ts"), join(root, "packages", "alias.ts"), "file");
			writeFileSync(join(outside, "secret.txt"), "secret\n");
			symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"), "file");
			symlinkSync(outside, join(root, "linked-out"), "dir");
			symlinkSync(join(root, "packages"), join(root, "pkg-link"), "dir");
			symlinkSync(root, join(root, "link-root"), "dir");

			expect(normalizeRepoPath("packages/alias.ts", root)).toBe("packages/alias.ts");
			expect(normalizeRepoPath("pkg-link/missing.ts", root)).toBe("pkg-link/missing.ts");
			expect(normalizeRepoPath("link-root", root)).toBe("link-root");
			expect(() => normalizeRepoPath("escape.txt", root)).toThrow("inside the repository");
			expect(() => normalizeRepoPath("linked-out/secret.txt", root)).toThrow("inside the repository");
			expect(() => normalizeRepoPath("linked-out/missing.ts", root)).toThrow("inside the repository");
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("quality timing output", () => {
	it("keeps short timings readable and longer timings comparable", () => {
		expect(formatElapsedTime(412)).toBe("412ms");
		expect(formatElapsedTime(12_345)).toBe("12.3s");
		expect(() => formatElapsedTime(-1)).toThrow("non-negative finite number");
	});
});

describe("standalone CLI 编译入口守卫", () => {
	it("拒绝在 Desktop 生产代码中直接编译 CLI 源入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/example.ts",
				`spawn("bun", ["build", join(cliAppRoot, "src", "cli.ts"), "--compile"]);`,
			),
		).toHaveLength(1);
	});

	it("允许调用统一编译器和编译其他入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/example.ts",
				`spawn("bun", [join(cliAppRoot, "scripts", "compile-standalone.mjs")]);`,
			),
		).toEqual([]);
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/dev-cli-shim.ts",
				`spawn("bun", ["build", launcherEntryPath, "--compile"]);`,
			),
		).toEqual([]);
	});
});

describe("vitest runner 守卫", () => {
	it("拒绝 bunx vitest 和直接 vitest", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { test: "bunx vitest --run", "test:unit": "vitest --run" },
			}),
		).toHaveLength(2);
	});

	it("允许统一 Node 包装器", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { test: "bun ../../scripts/quality/run-vitest.mjs --run --coverage" },
			}),
		).toEqual([]);
	});

	it("忽略不含 vitest 的脚本", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { build: "tsgo -p tsconfig.build.json", "test:e2e": "wdio run ./wdio.conf.ts" },
			}),
		).toEqual([]);
	});
});

describe("source path maps", () => {
	it("maps package.json types exports onto source files", () => {
		expect(typesExportToSourceRel("./dist/auth/index.d.ts")).toBe("src/auth/index.ts");
		expect(typesExportToSourceRel("./dist/npm-package.d.ts")).toBe("src/npm-package.ts");
		expect(typesExportToSourceRel("./src/tailwind-theme.css")).toBeNull();
	});

	it("ignores CSS and wildcard exports", () => {
		expect(
			collectTypeScriptExportEntries({
				name: "@vetta/example",
				exports: {
					".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
					"./theme.css": "./src/theme.css",
					"./*": "./dist/*",
				},
			}),
		).toEqual([{ specifier: "@vetta/example", sourceRel: "src/index.ts", types: "./dist/index.d.ts" }]);
	});

	it("requires an explicit root path map to the source file", () => {
		const packages = [
			{
				dir: "packages/runtime-mcp",
				manifest: {
					name: "@vetta/runtime-mcp",
					exports: {
						"./auth": { types: "./dist/auth/index.d.ts", import: "./dist/auth/index.js" },
					},
				},
			},
		];

		expect(findSourcePathMapViolations({ paths: {}, packages, fileExists: () => true })).toEqual([
			"@vetta/runtime-mcp/auth: root tsconfig.json is missing an explicit source path map to ./packages/runtime-mcp/src/auth/index.ts",
		]);
		expect(
			findSourcePathMapViolations({
				paths: { "@vetta/runtime-mcp/auth": ["./packages/runtime-mcp/src/auth/index.ts"] },
				packages,
				fileExists: () => true,
			}),
		).toEqual([]);
	});

	it("detects when an app wildcard alias misses an imported public export source", () => {
		const packages = [
			{
				dir: "packages/coding-agent",
				manifest: {
					name: "@vetta/coding-agent",
					exports: {
						"./plugin-runtime": {
							types: "./dist/public-api/plugin-runtime.d.ts",
							import: "./dist/public-api/plugin-runtime.js",
						},
					},
				},
			},
		];
		const importedSpecifiers = ["@vetta/coding-agent/plugin-runtime"];

		expect(
			findImportedSourcePathMapViolations({
				paths: { "@vetta/coding-agent/*": ["../../packages/coding-agent/src/*"] },
				importedSpecifiers,
				packages,
				configDir: "apps/desktop",
			}),
		).toEqual([
			"@vetta/coding-agent/plugin-runtime: apps/desktop/tsconfig.json maps to ../../packages/coding-agent/src/plugin-runtime, expected ../../packages/coding-agent/src/public-api/plugin-runtime.ts",
		]);
		expect(
			findImportedSourcePathMapViolations({
				paths: {
					"@vetta/coding-agent/plugin-runtime": ["../../packages/coding-agent/src/public-api/plugin-runtime.ts"],
				},
				importedSpecifiers,
				packages,
				configDir: "apps/desktop",
			}),
		).toEqual([]);
	});
});

describe("quick check selection", () => {
	it("checks every existing changed file and skips deleted files", () => {
		const existing = new Set(["package.json", "packages/ai/src/index.ts"]);
		const plan = createQuickCheckPlan(
			["packages\\ai\\src\\index.ts", "deleted.ts", "package.json", "package.json"],
			(file) => existing.has(file),
		);

		expect(plan.fullBiome).toBe(false);
		expect(plan.existingFiles).toEqual(["package.json", "packages/ai/src/index.ts"]);
		expect(plan.biomeBatches.flat()).toEqual(plan.existingFiles);
	});

	it("falls back to a full Biome check when any Biome config changes", () => {
		expect(isBiomeGlobalTrigger("config/biome.jsonc")).toBe(true);
		const plan = createQuickCheckPlan(["biome.json", "packages/ai/src/index.ts"], () => true);
		expect(plan.fullBiome).toBe(true);
		expect(plan.biomeBatches).toEqual([["."]]);
	});

	it("batches paths without dropping or reordering them", () => {
		const paths = ["first.ts", "second-long.ts", "third.ts"];
		const batches = batchPaths(paths, 20);
		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flat()).toEqual(paths);
	});

	it("runs only guards affected by the selected files", () => {
		const docsPlan = createQuickGuardPlan(["docs/dev/quality-gates.md"]);
		expect(docsPlan.map(([id]) => id)).toEqual(["private-keys", "conflict-markers"]);

		const rendererPlan = createQuickGuardPlan([
			"apps/desktop/src/renderer/domains/conversation/ConversationView.tsx",
		]);
		expect(rendererPlan.map(([id]) => id)).toEqual([
			"private-keys",
			"conflict-markers",
			"package-boundaries",
			"session-event-tombstones",
			"conversation-architecture",
		]);
		expect(rendererPlan.find(([id]) => id === "package-boundaries")).toContain(
			"apps/desktop/src/renderer/domains/conversation/ConversationView.tsx",
		);
		expect(rendererPlan.find(([id]) => id === "session-event-tombstones")).toContain(
			"apps/desktop/src/renderer/domains/conversation/ConversationView.tsx",
		);
	});
});

describe("affected package selection", () => {
	it("discovers every workspace test script, including nested plugins and themes", () => {
		expect(Object.keys(TESTABLE_PACKAGES)).toEqual(
			WORKSPACE_PACKAGES.filter((pkg) => Boolean(pkg.scripts.test)).map((pkg) => pkg.key),
		);
		expect(Object.keys(TESTABLE_PACKAGES)).toEqual(
			expect.arrayContaining(["capability-sdk", "cli-host", "runtime-node", "presets/image-gen"]),
		);
	});

	it("includes transitive testable dependents", () => {
		expect(expandTestablePackages(["ai"])).toEqual(
			expect.arrayContaining(["ai", "agent", "runtime-core", "runtime-mcp", "coding-agent", "desktop"]),
		);
		expect(expandTestablePackages(["runtime-mcp"])).toEqual(
			expect.arrayContaining(["runtime-mcp", "coding-agent", "desktop"]),
		);
		expect(expandTestablePackages(["ecosystem-adapter"])).toEqual(
			expect.arrayContaining(["coding-agent", "ecosystem-adapter", "desktop"]),
		);
		expect(expandTestablePackages(["plugin-sdk"])).toEqual(
			expect.arrayContaining(["presets/image-gen", "presets/vetta-ui-design", "desktop"]),
		);
	});

	it("runs Runtime and Desktop tests when those packages change", () => {
		expect(createChangedTestPlan(["packages/runtime-core/src/index.ts"]).targets).toMatchObject([
			{ key: "runtime-core", relatedSources: ["src/index.ts"] },
		]);
		expect(createChangedTestPlan(["apps/desktop/src/main/window-manager.ts"]).targets).toMatchObject([
			{ key: "desktop", relatedSources: ["src/main/window-manager.ts"] },
		]);
	});

	it("keeps ordinary test:changed source edits on targeted Vitest instead of the whole package", () => {
		const plan = createChangedTestPlan(
			[
				"apps/desktop/src/renderer/domains/conversation/components/annotations/AnnotationMenus.tsx",
				"apps/desktop/src/renderer/domains/conversation/components/annotations/AnnotationScope.test.tsx",
				"apps/docs-site/content/docs/core/workspaces-and-sessions.mdx",
			],
			[],
			() => true,
		);

		expect(plan.targets).toMatchObject([
			{
				key: "desktop",
				directTests: ["src/renderer/domains/conversation/components/annotations/AnnotationScope.test.tsx"],
				relatedSources: ["src/renderer/domains/conversation/components/annotations/AnnotationMenus.tsx"],
			},
		]);
		expect(plan.targets).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "docs-site" })]));
	});

	it("maps lockfile dependency changes back to importing source files without package tests", () => {
		const plan = createChangedTestPlan(
			["bun.lock", "package.json", "turbo.json"],
			[{ key: "externals/chinese-chess", dependencies: ["zh-chess"] }],
		);
		expect(plan.lockfileImpacts).toEqual([{ key: "externals/chinese-chess", dependencies: ["zh-chess"] }]);
		expect(plan.runQuality).toBe(true);
		expect(plan.targets).toMatchObject([
			{
				key: "externals/chinese-chess",
				directTests: [],
				relatedSources: ["src/game/engine.ts"],
			},
		]);
	});

	it("finds only workspaces whose resolved lockfile dependency closure changed", () => {
		const before = `{
			"lockfileVersion": 1,
			"workspaces": {
				"": { "name": "root", "devDependencies": { "vitest": "1.0.0" } },
				"packages/alpha": { "name": "@test/alpha", "dependencies": { "shared": "^1.0.0" } },
				"packages/beta": { "name": "@test/beta", "dependencies": { "other": "^1.0.0" } }
			},
			"packages": {
				"shared": ["shared@1.0.0", "shared.tgz", { "dependencies": { "leaf": "^1.0.0" } }, "hash-a"],
				"leaf": ["leaf@1.0.0", "leaf.tgz", {}, "hash-leaf"],
				"other": ["other@1.0.0", "other.tgz", {}, "hash-b"],
				"vitest": ["vitest@1.0.0", "vitest.tgz", {}, "hash-c"]
			}
		}`;
		const after = before.replaceAll("leaf@1.0.0", "leaf@1.1.0").replaceAll("hash-leaf", "hash-new");

		expect(
			changedLockfileWorkspaceKeys(before, after, [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
				{ key: "beta", dir: "packages/beta", name: "@test/beta" },
			]),
		).toEqual(["alpha"]);
		expect(
			changedLockfileWorkspaceImpacts(before, after, [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
				{ key: "beta", dir: "packages/beta", name: "@test/beta" },
			]),
		).toEqual([{ key: "alpha", dependencies: ["shared"] }]);
	});

	it("ignores formatting and root-only tool changes in lockfile package selection", () => {
		const before = `{
			"lockfileVersion": 1,
			"workspaces": {
				"": { "name": "root", "devDependencies": { "vitest": "1.0.0" } },
				"packages/alpha": { "name": "@test/alpha", "dependencies": { "shared": "^1.0.0" } }
			},
			"packages": {
				"shared": ["shared@1.0.0", "shared.tgz", {}, "hash-a"],
				"vitest": ["vitest@1.0.0", "vitest.tgz", {}, "hash-b"]
			}
		}`;
		const formattingOnly = before.replaceAll("  ", "    ");
		const rootToolOnly = before.replaceAll("vitest@1.0.0", "vitest@1.1.0").replaceAll("hash-b", "hash-new");
		const workspaces = [{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" }];

		expect(changedLockfileWorkspaceKeys(before, formattingOnly, workspaces)).toEqual([]);
		expect(changedLockfileWorkspaceKeys(before, rootToolOnly, workspaces)).toEqual([]);
	});

	it("fails lockfile impact analysis instead of degrading to every package", () => {
		expect(() => changedLockfileWorkspaceKeys("not json", "{}", [])).toThrow("cannot parse bun.lock");
		expect(() =>
			changedLockfileWorkspaceKeys('{ "workspaces": {}, "packages": {} }', '{ "workspaces": {}, "packages": {} }', [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
			]),
		).toThrow("current lockfile is missing workspace packages/alpha");
	});

	it("runs quality tests when their implementation changes", () => {
		const plan = createChangedTestPlan(["scripts/quality/test-changed.mjs"]);
		expect(plan.runQuality).toBe(true);
		expect(plan.qualityTests).toEqual(["scripts/quality/quality-gates.test.mjs"]);
		expect(plan.lockfileImpacts).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("does not run product tests for lint-only configuration changes", () => {
		const plan = createChangedTestPlan(["biome.json"]);
		expect(plan.runQuality).toBe(false);
		expect(plan.lockfileImpacts).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("leaves package and test configuration validation to check without running package tests", () => {
		const plan = createChangedTestPlan([
			"packages/ai/package.json",
			"packages/ai/tsconfig.build.json",
			"packages/ai/vitest.config.ts",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("accepts both base argument forms and rejects unknown arguments", () => {
		expect(parseArgs(["--base", "origin/main"])).toEqual({ base: "origin/main", files: [] });
		expect(parseArgs(["--base=origin/release"])).toEqual({ base: "origin/release", files: [] });
		expect(() => parseArgs(["--unknown"])).toThrow("unknown argument");
	});

	it("selects direct and related tests for ordinary task files", () => {
		const plan = createImpactTestPlan([
			"packages/ai/test/provider-retry-policy.test.ts",
			"packages/ai/src/providers/retry-policy.ts",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "ai",
				directTests: ["test/provider-retry-policy.test.ts"],
				relatedSources: ["src/providers/retry-policy.ts"],
			},
		]);
	});

	it("keeps public contracts on related tests and fails unselectable changes without a package-test fallback", () => {
		const publicContract = createImpactTestPlan(["packages/ai/src/index.ts"]);
		expect(publicContract.selectionErrors).toEqual([]);
		expect(publicContract.targets).toMatchObject([
			{
				key: "ai",
				directTests: [],
				relatedSources: ["src/index.ts"],
			},
		]);
		expect(publicContract.targets.every((target) => !("full" in target))).toBe(true);
		expect(createImpactTestPlan(["packages/ai/src/provider.ts"], () => false).selectionErrors).toEqual([
			"packages/ai/src/provider.ts was deleted; add an explicit regression test or mapping",
		]);
		expect(createImpactTestPlan(["packages/action-rpc/src/server.ts"]).selectionErrors).toEqual([
			"action-rpc has no targeted test entry point for packages/action-rpc/src/server.ts",
		]);
	});

	it("never exposes a package-test fallback from the changed-test runner", () => {
		const implementation = readFileSync(join(repoRoot, "scripts/quality/test-impact.mjs"), "utf8");
		expect(implementation).not.toContain("full package");
		expect(implementation).not.toContain("target.full");
		expect(implementation).not.toMatch(/runBun\(\["run",\s*"test"/u);
		expect(implementation).not.toContain('["run", "test:quality"]');
		expect(implementation).not.toContain("test-pkg.mjs");
	});

	it("uses explicit host component tests for shared model selector UI", () => {
		const plan = createImpactTestPlan([
			"apps/desktop/src/renderer/domains/conversation/connectors/team/TeamModelSelector.tsx",
			"packages/theme-ui/src/chat/ModelConfiguration.tsx",
			"packages/theme-ui/src/chat/ModelSelectorTrigger.tsx",
			"packages/theme-ui/src/chat/ModelSelectorView.tsx",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "desktop",
				directTests: [
					"src/renderer/domains/conversation/components/ModelSelectorView.test.tsx",
					"src/renderer/domains/conversation/connectors/team/TeamModelSelector.test.tsx",
				],
				relatedSources: [],
			},
		]);
	});

	it("selects Google and goal contracts without unrelated provider or SDK tests", () => {
		const files = [
			"packages/ai/src/providers/google-stream/request.ts",
			"packages/ai/test/google-native-adapters.test.ts",
			"packages/coding-agent/src/features/goal/goal-feature.ts",
			"packages/coding-agent/src/features/goal/goal-runtime.ts",
			"packages/coding-agent/src/features/goal/goal-session-extension.ts",
			"packages/coding-agent/test/composition/goal-execution.test.ts",
			"packages/coding-agent/test/features/goal/goal-session-extension.test.ts",
		];
		const impact = createImpactTestPlan(files);
		expect(impact.selectionErrors).toEqual([]);
		expect(impact.targets).toMatchObject([
			{ key: "ai", directTests: ["test/google-native-adapters.test.ts"], relatedSources: [] },
			{
				key: "coding-agent",
				directTests: [
					"test/composition/continuation-orchestration.test.ts",
					"test/composition/goal-execution.test.ts",
					"test/features/goal/goal-session-extension.test.ts",
				],
				relatedSources: [],
			},
		]);
		expect(createChangedTestPlan(files)).toEqual(impact);
	});

	it.each([
		"packages/ai/src/providers/google-stream/request.ts",
		"packages/coding-agent/src/features/goal/goal-feature.ts",
		"packages/coding-agent/src/features/goal/goal-runtime.ts",
		"packages/coding-agent/src/features/goal/goal-session-extension.ts",
	])("fails a reviewed contract mapping with a missing test: %s", (file) => {
		const plan = createImpactTestPlan([file], (path) => path === file);
		expect(plan.selectionErrors).toContain(`${file} has an invalid explicit test mapping`);
		expect(plan.targets).toEqual([]);
	});

	it("keeps packages with test prerequisites on targeted tests", () => {
		const plan = createImpactTestPlan(["packages/plugins/presets/vetta-ui-design/src/vetd/tool-gate.ts"]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "presets/vetta-ui-design",
				prerequisites: [["run", "build:runner"]],
				relatedSources: ["src/vetd/tool-gate.ts"],
			},
		]);
		expect(plan.targets.every((target) => !("full" in target))).toBe(true);
	});

	it("keeps unmapped source files inside workspaces with package tests on the targeted path", () => {
		const plan = createImpactTestPlan(["packages/theme-ui/src/chat/UnmappedView.tsx"], () => true);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "theme-ui",
				directTests: [],
				relatedSources: ["src/chat/UnmappedView.tsx"],
			},
		]);
	});

	it("runs quality tests for scripts while documentation-only changes need no package tests", () => {
		const quality = createImpactTestPlan(["scripts/quality/test-impact.mjs"]);
		expect(quality).toMatchObject({
			qualityTests: ["scripts/quality/quality-gates.test.mjs"],
			runQuality: true,
			selectionErrors: [],
			targets: [],
		});
		const workflow = createImpactTestPlan([".github/workflows/desktop-release.yml"]);
		expect(workflow).toMatchObject({
			qualityTests: ["scripts/quality/desktop-release-workflow.test.mjs"],
			runQuality: true,
			selectionErrors: [],
			targets: [],
		});
		const docs = createImpactTestPlan(["docs/dev/quality-gates.md"]);
		expect(docs).toMatchObject({ runQuality: false, selectionErrors: [], targets: [] });
		expect(parseImpactArgs(["--dry-run", "packages/ai/src/providers/retry-policy.ts"])).toMatchObject({
			dryRun: true,
			files: ["packages/ai/src/providers/retry-policy.ts"],
		});
	});

	it("throws when vitest fails to start and returns the exit code when tests fail", () => {
		const spawnFailure = () => ({
			error: Object.assign(new Error("spawn bun ENOENT"), { code: "ENOENT" }),
			status: null,
			signal: null,
			stdout: "",
			stderr: "",
		});
		expect(() => runCapturedBun(["scripts/quality/run-vitest.mjs"], repoRoot, spawnFailure)).toThrow(
			/failed to spawn vitest: spawn bun ENOENT/,
		);

		const testFailure = () => ({
			status: 1,
			signal: null,
			stdout: "",
			stderr: "",
		});
		expect(runCapturedBun(["scripts/quality/run-vitest.mjs"], repoRoot, testFailure)).toMatchObject({
			code: 1,
		});
	});

	it("falls back to the package suite only when the vitest report contains no tests", () => {
		expect(
			relatedResultAction(1, {
				numTotalTests: 0,
				numFailedTests: 0,
				numFailedTestSuites: 0,
				testResults: [],
			}),
		).toBe("fallback");
		expect(
			relatedResultAction(1, {
				numTotalTests: 2,
				numFailedTests: 1,
				numFailedTestSuites: 1,
				testResults: [{ name: "src/retry-policy.test.ts" }],
			}),
		).toBe("fail");
		expect(relatedResultAction(1, null)).toBe("fail");
		expect(relatedResultAction(0, { numTotalTests: 1, numFailedTests: 0, testResults: [{}] })).toBe("pass");
	});

	it("does not classify a missing related run by vitest's error message text", () => {
		const source = readFileSync(new URL("./test-impact.mjs", import.meta.url), "utf8");
		expect(source).not.toMatch(/No test files found\|No test suite found/);
		expect(relatedResultAction(1, null)).toBe("fail");
	});

	it("routes changed plugin manifests to repository manifest contract tests", () => {
		const plan = createImpactTestPlan(["packages/plugins/externals/chinese-chess/plugin.json"]);
		expect(plan.targets).toEqual([]);
		expect(plan).toMatchObject({
			qualityTests: ["scripts/quality/plugin-manifests.test.mjs"],
			runQuality: true,
			selectionErrors: [],
		});
	});

	it("builds generated workspace exports required by tests without building leaf applications", () => {
		const dependencies = buildableTestDependencies(Object.keys(TESTABLE_PACKAGES));
		expect(dependencies).toEqual(
			expect.arrayContaining([
				"@vetta/action-rpc",
				"@vetta/runtime-storage",
				"@vetta-org/plugin-sdk",
				"@vetta/toolkit",
			]),
		);
		expect(dependencies).not.toEqual(
			expect.arrayContaining(["@vetta/desktop", "@vetta/docs-site", "@vetta/remote-relay"]),
		);
	});
});

describe("workspace discovery cache", () => {
	function createWorkspaceFixture(workspaces, packages) {
		const root = mkdtempSync(join(tmpdir(), "vetta-workspace-"));
		writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces }));
		for (const pkg of packages) {
			mkdirSync(join(root, pkg.dir), { recursive: true });
			writeFileSync(
				join(root, pkg.dir, "package.json"),
				JSON.stringify({ name: pkg.name, scripts: pkg.scripts ?? {} }),
			);
		}
		return root;
	}

	function removeFixture(root) {
		rmSync(root, { recursive: true, force: true });
	}

	it("reuses the first scan for the same repository root", () => {
		expect(discoverWorkspacePackages()).toBe(WORKSPACE_PACKAGES);
		expect(discoverWorkspacePackages(repoRoot)).toBe(WORKSPACE_PACKAGES);
	});

	it("does not rescan after the first visit to a root", () => {
		const root = createWorkspaceFixture(["packages/*"], [{ dir: "packages/alpha", name: "alpha" }]);
		try {
			const first = discoverWorkspacePackages(root);
			mkdirSync(join(root, "packages/beta"), { recursive: true });
			writeFileSync(join(root, "packages/beta/package.json"), JSON.stringify({ name: "beta" }));
			const second = discoverWorkspacePackages(root);
			expect(second).toBe(first);
			expect(second.map((pkg) => pkg.key)).toEqual(["alpha"]);
		} finally {
			removeFixture(root);
		}
	});

	it("keeps discovery results isolated per root", () => {
		const left = createWorkspaceFixture(["packages/*"], [{ dir: "packages/left", name: "left" }]);
		const right = createWorkspaceFixture(["packages/*"], [{ dir: "packages/right", name: "right" }]);
		try {
			expect(discoverWorkspacePackages(left).map((pkg) => pkg.name)).toEqual(["left"]);
			expect(discoverWorkspacePackages(right).map((pkg) => pkg.name)).toEqual(["right"]);
		} finally {
			removeFixture(left);
			removeFixture(right);
		}
	});

	it("returns a cached list ordered so nested workspaces win", () => {
		const dirs = getWorkspacesBySpecificity().map((pkg) => pkg.dir);
		const nested = "packages/coding-agent/examples/extensions/with-deps";
		const parent = "packages/coding-agent";
		expect(dirs.indexOf(nested)).toBeGreaterThanOrEqual(0);
		expect(dirs.indexOf(nested)).toBeLessThan(dirs.indexOf(parent));
		expect(getWorkspacesBySpecificity()).toBe(getWorkspacesBySpecificity());
	});

	it("maps a file to the most specific workspace", () => {
		expect(workspaceForFile("packages/coding-agent/examples/extensions/with-deps/src/index.ts")?.key).toBe(
			"coding-agent/examples/extensions/with-deps",
		);
		expect(workspaceForFile("packages/coding-agent/src/index.ts")?.key).toBe("coding-agent");
		expect(workspaceForFile("packages\\ai\\src\\index.ts")?.key).toBe("ai");
		expect(workspaceForFile("docs/dev/quality-gates.md")).toBeUndefined();
		expect(packagesFromPaths(["packages/coding-agent/examples/extensions/with-deps/src/index.ts"])).toEqual([
			"coding-agent/examples/extensions/with-deps",
		]);
	});

	it("pre-sorts a custom root so the nested workspace owns nested files", () => {
		const root = createWorkspaceFixture(
			["packages/*", "packages/group/*"],
			[
				{ dir: "packages/group", name: "group" },
				{ dir: "packages/group/child", name: "child" },
			],
		);
		try {
			expect(getWorkspacesBySpecificity(root).map((pkg) => pkg.dir)).toEqual([
				"packages/group/child",
				"packages/group",
			]);
			expect(workspaceForFile("packages/group/child/src/index.ts", root)?.name).toBe("child");
			expect(workspaceForFile("packages/group/src/index.ts", root)?.name).toBe("group");
			expect(getWorkspacesBySpecificity(root)).toBe(getWorkspacesBySpecificity(root));
		} finally {
			removeFixture(root);
		}
	});
});

describe("CI unit test coverage", () => {
	const workflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8");
	const imGatewayWorkflow = readFileSync(join(repoRoot, ".github/workflows/im-gateway.yml"), "utf8");
	const kotlinWorkflow = readFileSync(join(repoRoot, ".github/workflows/kotlin.yml"), "utf8");
	const appleWorkflow = readFileSync(join(repoRoot, ".github/workflows/mobile-apple.yml"), "utf8");
	const docsWorkflow = readFileSync(join(repoRoot, ".github/workflows/docs-site.yml"), "utf8");
	const desktopPackagedWorkflow = readFileSync(join(repoRoot, ".github/workflows/desktop-packaged.yml"), "utf8");
	const precommit = readFileSync(join(repoRoot, "scripts/quality/precommit.mjs"), "utf8");
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

	it("runs portable tests on Linux and keeps Windows path/process coverage", () => {
		expect(workflow).toContain("os: [ubuntu-latest, windows-latest]");
		expect(workflow).toContain("fetch-depth: 0");
		expect(workflow).toContain("command -v rg >/dev/null || { sudo apt-get update");
		expect(workflow).toContain("Get-Command rg -ErrorAction SilentlyContinue");
		expect(workflow).toContain("bun run test:changed --base");
	});

	it("cancels stale runs, fails the platform matrix fast, and installs Bun packages without Actions caches", () => {
		expect(workflow).toContain("cancel-in-progress: true");
		expect(workflow).toContain("fail-fast: true");
		expect(workflow.match(/uses: actions\/checkout@v7/g)).toHaveLength(2);
		expect(workflow.match(/uses: \.\/\.github\/actions\/install-bun-dependencies/g)).toHaveLength(2);
		const installAction = readFileSync(join(repoRoot, ".github/actions/install-bun-dependencies/action.yml"), "utf8");
		expect(installAction).not.toContain("node_modules");
		expect(installAction).not.toContain("actions/cache");
	});

	it("defaults to affected tests and keeps explicit full tests sequential and discovery-based", () => {
		expect(rootManifest.scripts["test:full"]).toBe("bun run scripts/quality/test-pkg.mjs --all");
		expect(rootManifest.scripts.test).toBe("bun run test:impact");
		expect(rootManifest.scripts["test:unit"]).toBe("bun run test:impact");
	});

	it("keeps full lint explicit for CI and publication while local lint selects changes", () => {
		expect(rootManifest.scripts["check:lint"]).toBe("bun run scripts/quality/check-lint.mjs");
		expect(rootManifest.scripts["check:lint:full"]).toBe("bun run scripts/quality/check-lint.mjs --full");
		expect(rootManifest.scripts["check:full"]).toContain("bun run check:lint:full");
		expect(rootManifest.scripts["check:full"]).toContain("bun run check:types");
		expect(rootManifest.scripts["check:full"]).toContain("bun run check:guards");
		expect(rootManifest.scripts.prepublishOnly).toContain("bun run check:full");
		expect(workflow).toMatch(/run: bun run check:full\r?\n/);
		const release = readFileSync(join(repoRoot, "scripts/release-desktop.mjs"), "utf8");
		expect(release).toContain('["run", "check:lint:full"]');
	});

	it("does not duplicate checks already owned by the repository quality workflow", () => {
		expect(rootManifest.scripts["check:types"]).not.toContain("apps/cli-host typecheck");
		expect(docsWorkflow).not.toContain("bun run --cwd apps/docs-site check");
		expect(docsWorkflow).not.toContain("bun run --cwd apps/docs-site test");
		expect(docsWorkflow).toContain("bun run build:docs");
		expect(desktopPackagedWorkflow).not.toContain("node apps/desktop/scripts/verify-packaging-contract.mjs");
	});

	it("keeps pre-commit read-only so partial staging is preserved", () => {
		expect(precommit).not.toContain('"--write"');
		expect(precommit).not.toContain('git(["add"');
		expect(precommit).toContain('"--staged"');
	});

	it("builds the Android app and runs host tests when Kotlin changes", () => {
		expect(kotlinWorkflow).toContain('      - "apps/mobile/client-android/**"');
		expect(kotlinWorkflow).toContain(":shared:testAndroidHostTest");
		expect(kotlinWorkflow).toContain(":androidApp:assembleDebug");
	});

	it("tests VettaKit, the desktop interop and the iOS build when the Apple client or the protocol changes", () => {
		expect(appleWorkflow).toContain('      - "apps/mobile/client-apple/**"');
		expect(appleWorkflow).toContain('      - "packages/remote-control/**"');
		expect(appleWorkflow).toContain("swift test --no-parallel");
		expect(appleWorkflow).toContain("scripts/interop.sh");
		expect(appleWorkflow).toContain("xcodebuild build");
	});

	it("limits path-filtered app checks to branch pushes", () => {
		for (const appWorkflow of [imGatewayWorkflow, kotlinWorkflow, appleWorkflow]) {
			expect(appWorkflow).toMatch(/push:\r?\n {4}branches:\r?\n {6}- "\*\*"\r?\n {4}paths:/);
		}
	});
});

describe("durable package boundaries", () => {
	const check = findDurablePackageBoundaryViolations;

	it("blocks application imports from reusable packages and ignores import-looking comments", () => {
		const file = "packages/ai/src/example.ts";
		expect(check(file, 'import "@vetta/desktop";')).toHaveLength(1);
		expect(check(file, 'const host = await import("@vetta/cli-host/runtime");')).toHaveLength(1);
		expect(check(file, '// import host from "@vetta/desktop";')).toEqual([]);
	});

	it("flags a dynamic import that also passes import attributes", () => {
		const file = "packages/ai/src/example.ts";
		const imported = 'const app = await import("@vetta/desktop", { with: { type: "json" } });';
		const required = 'const app = require("@vetta/desktop", true);';
		const expected = [`${file}: libs/plugins must not import app package (@vetta/desktop)`];
		expect(findPackageBoundaryViolations(file, imported)).toEqual(expected);
		expect(findPackageBoundaryViolations(file, required)).toEqual(expected);
	});

	it("blocks production imports from test trees but allows tests to share fixtures", () => {
		const source = 'import { fixture } from "../../agent/test/fixture";';
		expect(check("packages/ai/src/example.ts", source)).toHaveLength(1);
		expect(check("packages/ai/src/example.test.ts", source)).toEqual([]);
	});

	it("keeps plugin code behind the public SDK and Desktop behind exported CLI contracts", () => {
		expect(check("packages/plugins/externals/example/src/index.ts", "window.vetta.fs.readFile(path);")).toHaveLength(
			1,
		);
		expect(check("apps/desktop/src/main/example.ts", 'import "../../../../cli-host/src/cli";')).toHaveLength(1);
	});

	it("keeps Desktop renderer MCP runtime values on the browser-safe entry", () => {
		const file = "apps/desktop/src/renderer/example.ts";
		expect(check(file, 'import { connect } from "@vetta/runtime-mcp";')).toHaveLength(1);
		expect(check(file, 'import { connect } from "@vetta/runtime-mcp/browser";')).toEqual([]);
		expect(check(file, 'import type { Config } from "@vetta/runtime-mcp";')).toEqual([]);
	});

	it("keeps capability identifiers and schemas owned by capability definitions", () => {
		expect(check("packages/ai/src/example.ts", 'const id = "cap.domain.vetta.example.read";')).toHaveLength(1);
		expect(
			check(
				"packages/capability-sdk/src/domain/example.ts",
				"const token = defineCapability<Input, Output>({ parseInput: parse, parseOutput: parse });",
			),
		).toHaveLength(2);
	});

	it("keeps runtime protocols and runtime-core platform neutral", () => {
		expect(check("packages/runtime-storage/src/index.ts", 'import { readFile } from "node:fs";')).toHaveLength(1);
		expect(check("packages/runtime-tools/src/index.ts", 'import "@vetta/runtime-node";')).toHaveLength(1);
		expect(check("packages/runtime-mcp/src/index.ts", 'import "@vetta/runtime-desktop";')).toHaveLength(1);
		expect(check("packages/runtime-core/src/index.ts", "const bytes = Buffer.from('x');")).toHaveLength(1);
	});

	it("keeps product semantics and Coding Agent dependencies above the generic runtimes", () => {
		expect(check("packages/runtime-core/src/index.ts", "const enableSubagents = true;")).toHaveLength(1);
		expect(check("packages/runtime-core/src/index.ts", 'import "@vetta/coding-agent/sdk";')).toHaveLength(1);
		expect(check("packages/agent/src/index.ts", 'import "@vetta/runtime-core";')).toHaveLength(1);
	});

	it("requires explicit Coding Agent subpaths and does not publish concrete tools", () => {
		expect(check("apps/desktop/src/main/example.ts", 'import "@vetta/coding-agent";')).toHaveLength(1);
		expect(
			check("packages/coding-agent/src/index.ts", 'export { createReadTool } from "@vetta/runtime-tools/coding";'),
		).not.toEqual([]);
	});

	it("requires selected workspace imports to be declared in their manifest", () => {
		const manifest = { name: "@vetta/runtime-storage", dependencies: {} };
		expect(check("packages/runtime-storage/src/index.ts", 'import "@vetta/action-rpc";', { manifest })).toHaveLength(
			1,
		);
		expect(
			check("packages/runtime-storage/src/index.ts", 'import "@vetta/action-rpc";', {
				manifest: { ...manifest, dependencies: { "@vetta/action-rpc": "workspace:*" } },
			}),
		).toEqual([]);
	});

	it("keeps agent-core manifests below runtime and product packages", () => {
		expect(
			findDurablePackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/runtime-core": "workspace:*" },
			}),
		).toHaveLength(1);
		expect(
			findDurablePackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/ai": "workspace:*" },
			}),
		).toEqual([]);
	});

	it("does not turn migration vocabulary into permanent architecture contracts", () => {
		expect(
			check(
				"packages/coding-agent/src/composition/runtime-composition.ts",
				"const childComposition = {}; const legacyAdapter = {};",
			),
		).toEqual([]);
	});
});

describe("Turborepo build orchestration", () => {
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	const turboConfig = JSON.parse(readFileSync(join(repoRoot, "turbo.json"), "utf8"));

	it("derives build order from the workspace graph and caches declared artifacts", () => {
		expect(turboConfig.tasks.build.dependsOn).toEqual(["^build"]);
		expect(turboConfig.globalDependencies).toEqual(expect.arrayContaining(["tsconfig.base.json", ".env", ".env.*"]));
		expect(turboConfig.envMode).toBe("strict");
		expect(turboConfig.tasks.build.inputs).toEqual(
			expect.arrayContaining(["$TURBO_DEFAULT$", "!test/**", "!tests/**", "!README*", "!CHANGELOG*"]),
		);
		expect(turboConfig.tasks.build.outputs).toEqual(
			expect.arrayContaining(["dist/**", "release/**", ".next/**", "!.next/cache/**"]),
		);
		expect(turboConfig.tasks.build.env).toEqual(
			expect.arrayContaining(["NODE_ENV", "VETTA_PLUGIN_DEV_WATCH", "VETTA_PLUGIN_DOCS_SRC", "VETD_SRC"]),
		);
		const docsBuild = turboConfig.tasks["@vetta/docs-site#build"];
		expect(docsBuild.env).toEqual(["DOCS_SITE_URL", "NODE_ENV"]);
		expect(docsBuild.dependsOn).toContain("^build");
		expect(docsBuild.outputs).toContain(".next/**");
		const pluginWorkbenchBuild = turboConfig.tasks["@vetta/plugin-plugin-workbench#build"];
		expect(pluginWorkbenchBuild.inputs).toContain("$TURBO_ROOT$/docs/plugin/**");
		expect(pluginWorkbenchBuild.dependsOn).toContain("^build");
		expect(pluginWorkbenchBuild.outputs).toContain("release/**");
		expect(pluginWorkbenchBuild.env).toEqual(expect.arrayContaining(turboConfig.tasks.build.env));
	});

	it("keeps Desktop build and remote cache outside the initial cache boundary", () => {
		expect(turboConfig.tasks["@vetta/desktop#build"]).toMatchObject({
			cache: false,
		});
		expect(turboConfig.tasks["@vetta/desktop#build"].dependsOn).toEqual(
			expect.arrayContaining(["^build", "@vetta-org/plugin-vite#build"]),
		);
		expect(turboConfig.tasks["@vetta/desktop#build"].env).toEqual(
			expect.arrayContaining(["NODE_ENV", "VETTA_*", "VETD_*"]),
		);
		expect(turboConfig.remoteCache).toEqual({ enabled: false, signature: true });
	});

	it("routes root builds through Turbo while preserving preset orchestration", () => {
		expect(rootManifest.devDependencies.turbo).toMatch(/^\d+\.\d+\.\d+$/);
		expect(rootManifest.scripts.build).toContain("turbo run build");
		expect(rootManifest.scripts.build).toContain("--filter=@vetta-org/plugin-vite");
		expect(rootManifest.scripts.build).toContain("build:preset:prebuilt");
		expect(rootManifest.scripts["build:desktop"]).toContain("--filter=@vetta/desktop");
		expect(rootManifest.scripts["build:cli"]).toContain("--filter=@vetta/cli-host");
		expect(rootManifest.scripts["build:cli"]).toContain("--filter=@vetta-org/plugin-vite");
		expect(rootManifest.scripts["build:cli"]).toContain("build:preset:prebuilt");
		expect(rootManifest.scripts["build:docs"]).toContain("turbo run build");
		expect(rootManifest.scripts["build:preset"]).toBe("bun run --cwd apps/desktop build:presets");
		expect(rootManifest.scripts["build:preset:prebuilt"]).toBe("bun run --cwd apps/desktop build:presets:prebuilt");
		expect(Object.values(rootManifest.scripts).join("\n")).not.toContain("--env-mode=loose");
		expect(Object.values(rootManifest.scripts).join("\n")).not.toContain("scripts/build.sh");
	});

	it("keeps Vercel docs builds independent from excluded Git history", () => {
		const vercelConfig = JSON.parse(readFileSync(join(repoRoot, "apps/docs-site/vercel.json"), "utf8"));
		const vercelIgnore = readFileSync(join(repoRoot, ".vercelignore"), "utf8");
		const docsWorkflow = readFileSync(join(repoRoot, ".github/workflows/docs-site.yml"), "utf8");
		expect(vercelConfig.buildCommand).toContain("build:docs");
		expect(vercelConfig.ignoreCommand).toBeUndefined();
		expect(vercelIgnore).toContain("\n/docs\n");
		expect(vercelIgnore).not.toMatch(/\ndocs\r?\n/u);
		expect(docsWorkflow).toContain('"package.json"');
		expect(docsWorkflow).toContain('"turbo.json"');
		expect(docsWorkflow).toContain("bun run build:docs");
	});

	it("enforces cache safety as an always-on repository contract", () => {
		expect(findTurboConfigurationProblems(readTurboConfiguration())).toEqual([]);
		const configuration = readTurboConfiguration();
		configuration.turboConfig = {
			...configuration.turboConfig,
			globalDependencies: [".env", ".env.*"],
		};
		expect(findTurboConfigurationProblems(configuration)).toContain(
			"turbo globalDependencies 缺少 tsconfig.base.json",
		);
	});

	it("records Turbo summaries for test dependency builds and uploads them from CI", () => {
		const testPackageScript = readFileSync(join(repoRoot, "scripts/quality/test-pkg.mjs"), "utf8");
		const qualityWorkflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8");
		expect(testPackageScript).toContain('"--summarize"');
		expect(qualityWorkflow).toContain("Upload Turbo run summaries");
		expect(qualityWorkflow).toContain(".turbo/runs/*.json");
		expect(qualityWorkflow).toContain("retention-days: 7");
	});

	it("removes superseded hand-written task graphs", () => {
		for (const path of [
			"scripts/build.sh",
			"scripts/build.ps1",
			"scripts/workspace-build-dependencies.mjs",
			"scripts/quality/check-build-order.mjs",
			"apps/desktop/scripts/build-workspace-prereqs.mjs",
		]) {
			expect(existsSync(join(repoRoot, path)), path).toBe(false);
		}
	});
});

describe("skill frontmatter analysis", () => {
	const wrap = (frontmatter) => `---\n${frontmatter}\n---\n\n# Skill body\n`;

	it("accepts a plain skill", () => {
		expect(findSkillFrontmatterProblems(wrap("name: demo\ndescription: Does a thing when asked."))).toEqual([]);
	});

	it("rejects an unquoted description containing a colon — it makes the skill vanish silently", () => {
		const problems = findSkillFrontmatterProblems(wrap("name: demo\ndescription: Use it: it does a thing."));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('contains ": "');
	});

	it("accepts the same description once quoted", () => {
		expect(findSkillFrontmatterProblems(wrap('name: demo\ndescription: "Use it: it does a thing."'))).toEqual([]);
	});

	it("accepts folded block scalars and measures their real length", () => {
		expect(findSkillFrontmatterProblems(wrap("name: demo\ndescription: >\n  Does a thing\n  when asked."))).toEqual(
			[],
		);
		const long = `name: demo\ndescription: >\n  ${"x".repeat(1100)}`;
		expect(findSkillFrontmatterProblems(wrap(long))).toHaveLength(1);
	});

	it("requires frontmatter and a description", () => {
		expect(findSkillFrontmatterProblems("# No frontmatter\n")).toHaveLength(1);
		expect(findSkillFrontmatterProblems(wrap("name: demo"))).toHaveLength(1);
	});
});

describe("guard error reporting", () => {
	it("keeps process.exit out of the migrated guard scripts", () => {
		for (const file of [
			"scripts/quality/check-private-keys.mjs",
			"scripts/quality/check-conflict-markers.mjs",
			"scripts/quality/check-skill-frontmatter.mjs",
		]) {
			expect(readFileSync(join(repoRoot, file), "utf8"), file).not.toContain("process.exit(");
		}
	});

	it("records the file, line, rule, message, and error severity", () => {
		expect(new CheckViolation("apps/demo.ts", 4, "conflict-marker", "unresolved conflict marker")).toEqual({
			file: "apps/demo.ts",
			line: 4,
			rule: "conflict-marker",
			message: "unresolved conflict marker",
			severity: "error",
		});
	});

	it("keeps an explicit severity on the violation", () => {
		expect(new CheckViolation("apps/demo.ts", 1, "demo", "heads up", "warning").severity).toBe("warning");
	});

	it("prints a pass line and returns 0 when the guard finds nothing", () => {
		const lines = [];
		const code = runCheck("conflict-markers", () => [], { log: (line) => lines.push(line) });

		expect(code).toBe(0);
		expect(lines).toEqual(["[conflict-markers] passed"]);
	});

	it("writes the pass line to stdout when no reporter is passed", () => {
		const lines = [];
		const spy = vi.spyOn(console, "log").mockImplementation((line) => {
			lines.push(line);
		});
		try {
			expect(runCheck("conflict-markers", () => [])).toBe(0);
			expect(lines).toEqual(["[conflict-markers] passed"]);
		} finally {
			spy.mockRestore();
		}
	});

	it("prints file:line: message (rule) and returns 1 without exiting", () => {
		const previousExitCode = process.exitCode;
		const lines = [];
		const code = runCheck(
			"conflict-markers",
			() => [new CheckViolation("apps/demo.ts", 4, "conflict-marker", "unresolved conflict marker")],
			{ error: (line) => lines.push(line) },
		);

		expect(code).toBe(1);
		expect(lines).toEqual(["[conflict-markers] apps/demo.ts:4: unresolved conflict marker (conflict-marker)"]);
		expect(process.exitCode).toBe(previousExitCode);
	});

	it("turns a thrown check into an internal error status", () => {
		const lines = [];
		const code = runCheck(
			"private-key",
			() => {
				throw new Error("disk full");
			},
			{ error: (line) => lines.push(line) },
		);

		expect(code).toBe(1);
		expect(lines).toEqual(["[private-key] internal error: disk full"]);
	});
});

describe("conflict marker guard", () => {
	const start = `${"<".repeat(7)} `;
	const middle = "=".repeat(7);
	const end = `${">".repeat(7)} `;

	it("reports every marker line through the shared status code", () => {
		const text = `keep\n${start}HEAD\nours\n${middle}\ntheirs\n${end}branch\n`;
		const violations = findConflictMarkerViolationsInText("apps/demo.ts", text);
		const lines = [];
		const code = runCheck("conflict-markers", () => violations, { error: (line) => lines.push(line) });

		expect(violations).toEqual([
			new CheckViolation("apps/demo.ts", 2, "conflict-marker", "unresolved conflict marker"),
			new CheckViolation("apps/demo.ts", 4, "conflict-marker", "unresolved conflict marker"),
			new CheckViolation("apps/demo.ts", 6, "conflict-marker", "unresolved conflict marker"),
		]);
		expect(code).toBe(1);
		expect(lines).toEqual([
			"[conflict-markers] apps/demo.ts:2: unresolved conflict marker (conflict-marker)",
			"[conflict-markers] apps/demo.ts:4: unresolved conflict marker (conflict-marker)",
			"[conflict-markers] apps/demo.ts:6: unresolved conflict marker (conflict-marker)",
		]);
	});

	it("accepts a clean file and ignores a marker that is not at column 0", () => {
		expect(findConflictMarkerViolationsInText("apps/demo.ts", "no markers\n")).toEqual([]);
		expect(findConflictMarkerViolationsInText("apps/demo.ts", `  ${start}not a marker\n`)).toEqual([]);
	});

	it("reports a marker stored with CRLF newlines", () => {
		expect(findConflictMarkerViolationsInText("apps/demo.ts", `keep\r\n${middle}\r\n`)).toEqual([
			new CheckViolation("apps/demo.ts", 2, "conflict-marker", "unresolved conflict marker"),
		]);
	});

	it("skips a file that cannot be read and still checks the rest", () => {
		const violations = checkConflictMarkers(["missing.ts", "apps/demo.ts"], (file) => {
			if (file === "missing.ts") throw new Error("ENOENT");
			return `${middle}\n`;
		});

		expect(violations).toEqual([
			new CheckViolation("apps/demo.ts", 1, "conflict-marker", "unresolved conflict marker"),
		]);
	});

	it("reads a repo-relative path with the default reader", () => {
		expect(checkConflictMarkers(["scripts/quality/lib.mjs"])).toEqual([]);
	});

	it("checks README, docs, and package text for conflict markers in both quick and full scans", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-conflict-scope-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			mkdirSync(join(root, "packages", "demo", "src"), { recursive: true });
			mkdirSync(join(root, "packages", "demo", "node_modules", "left"), { recursive: true });
			writeFileSync(join(root, "README.md"), "# readme\n");
			writeFileSync(join(root, "docs", "guide.md"), "# guide\n");
			writeFileSync(join(root, "packages", "demo", "src", "index.ts"), "export {}\n");
			writeFileSync(join(root, "packages", "demo", "README.md"), "# pkg\n");
			writeFileSync(join(root, "packages", "demo", "node_modules", "left", "index.ts"), "export {}\n");
			writeFileSync(join(root, "apps-icon.png"), "not-really-png");

			const full = listConflictMarkerTargets(root).sort();
			expect(full).toEqual(["README.md", "docs/guide.md", "packages/demo/README.md", "packages/demo/src/index.ts"]);
			const changed = [
				"README.md",
				"docs/guide.md",
				"packages/demo/src/index.ts",
				"packages/demo/node_modules/left/index.ts",
				"apps-icon.png",
			];
			expect(selectConflictMarkerFiles(changed)).toEqual([
				"README.md",
				"docs/guide.md",
				"packages/demo/src/index.ts",
			]);
			expect(listConflictMarkerTargets()).toEqual(
				expect.arrayContaining(["README.md", "docs/dev/quality-gates.md"]),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("private key guard", () => {
	const begin = "-----BEGIN ";
	const endKey = "PRIVATE KEY-----";

	it("reports the first matching key and its line", () => {
		const text = `note\n${begin}RSA ${endKey}\nbody\n`;
		const violations = findPrivateKeyViolationsInText("secrets/id_rsa", text);
		const lines = [];
		const code = runCheck("private-key", () => violations, { error: (line) => lines.push(line) });

		expect(violations).toEqual([
			new CheckViolation("secrets/id_rsa", 2, "rsa-private-key", "possible RSA private key"),
		]);
		expect(code).toBe(1);
		expect(lines).toEqual(["[private-key] secrets/id_rsa:2: possible RSA private key (rsa-private-key)"]);
	});

	it("reports a generic key block when no specific type matches", () => {
		expect(findPrivateKeyViolationsInText("secrets/key.pem", `${begin}${endKey}\n`)).toEqual([
			new CheckViolation("secrets/key.pem", 1, "generic-private-key", "possible generic PRIVATE KEY block"),
		]);
	});

	it("reports EC, DSA, and PGP private keys", () => {
		expect(findPrivateKeyViolationsInText("secrets/ec.pem", `${begin}EC ${endKey}\n`)).toEqual([
			new CheckViolation("secrets/ec.pem", 1, "ec-private-key", "possible EC private key"),
		]);
		expect(findPrivateKeyViolationsInText("secrets/dsa.pem", `${begin}DSA ${endKey}\n`)).toEqual([
			new CheckViolation("secrets/dsa.pem", 1, "dsa-private-key", "possible DSA private key"),
		]);
		expect(findPrivateKeyViolationsInText("secrets/key.asc", `${begin}PGP PRIVATE KEY BLOCK-----\n`)).toEqual([
			new CheckViolation("secrets/key.asc", 1, "pgp-private-key", "possible PGP private key block"),
		]);
	});

	it("accepts text with no key and ignores a key past the size cap", () => {
		expect(findPrivateKeyViolationsInText("secrets/note.txt", "just a note\n")).toEqual([]);
		const huge = `${"a".repeat(2_000_000)}\n${begin}RSA ${endKey}\n`;
		expect(findPrivateKeyViolationsInText("secrets/huge.pem", huge)).toEqual([]);
	});

	it("skips a file that cannot be read and still checks the rest", () => {
		const violations = checkPrivateKeys(["missing.pem", "secrets/id_rsa"], (file) => {
			if (file === "missing.pem") throw new Error("ENOENT");
			return `${begin}OPENSSH ${endKey}\n`;
		});

		expect(violations).toEqual([
			new CheckViolation("secrets/id_rsa", 1, "openssh-private-key", "possible OPENSSH private key"),
		]);
	});

	it("checks repo-root text and pem keys in the full scan, and still skips docs", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-private-key-scope-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			mkdirSync(join(root, "packages", "demo"), { recursive: true });
			mkdirSync(join(root, "scripts", "quality"), { recursive: true });
			writeFileSync(join(root, "README.md"), "# readme\n");
			writeFileSync(join(root, "docs", "guide.md"), "# guide\n");
			writeFileSync(join(root, "packages", "demo", "id_rsa.pem"), "pem\n");
			writeFileSync(join(root, "packages", "demo", "note.txt"), "note\n");
			writeFileSync(join(root, "scripts", "quality", "helper.mjs"), "export {}\n");

			expect(listPrivateKeyTargets(root).sort()).toEqual([
				"README.md",
				"packages/demo/id_rsa.pem",
				"packages/demo/note.txt",
			]);
			expect(selectPrivateKeyFiles(["README.md", "docs/guide.md", "packages/demo/id_rsa.pem"])).toEqual([
				"README.md",
				"packages/demo/id_rsa.pem",
			]);
			expect(listPrivateKeyTargets()).toContain("README.md");
			expect(listPrivateKeyTargets()).not.toContain("docs/dev/quality-gates.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("skill frontmatter guard", () => {
	const wrap = (frontmatter) => `---\n${frontmatter}\n---\n\n# Skill body\n`;

	it("reports an unquoted colon with its line and returns status 1", () => {
		const file = "packages/demo/SKILL.md";
		const text = wrap("name: demo\ndescription: Use it: it does a thing.");
		const violations = findSkillFrontmatterViolations(file, text);
		const lines = [];
		const code = runCheck("skill-frontmatter", () => violations, { error: (line) => lines.push(line) });

		expect(violations).toEqual([
			new CheckViolation(
				file,
				3,
				"unquoted-scalar",
				'`description` contains ": " — YAML reads it as a nested mapping and fails to parse (wrap the value in double quotes)',
			),
		]);
		expect(code).toBe(1);
		expect(lines).toEqual([
			'[skill-frontmatter] packages/demo/SKILL.md:3: `description` contains ": " — YAML reads it as a nested mapping and fails to parse (wrap the value in double quotes) (unquoted-scalar)',
		]);
	});

	it("reports a missing block and a missing description", () => {
		expect(findSkillFrontmatterViolations("packages/demo/SKILL.md", "# No frontmatter\n")).toEqual([
			new CheckViolation(
				"packages/demo/SKILL.md",
				1,
				"frontmatter-block",
				"missing or unterminated --- frontmatter block",
			),
		]);
		expect(findSkillFrontmatterViolations("packages/demo/SKILL.md", wrap("name: demo"))).toEqual([
			new CheckViolation(
				"packages/demo/SKILL.md",
				1,
				"description-required",
				"description is required — it is the only text the model sees before invoking the skill",
			),
		]);
		expect(findSkillFrontmatterViolations("packages/demo/SKILL.md", wrap("name: demo\ndescription:"))).toEqual([
			new CheckViolation(
				"packages/demo/SKILL.md",
				3,
				"description-required",
				"description is required — it is the only text the model sees before invoking the skill",
			),
		]);
	});

	it("reports an oversized folded description on the key line", () => {
		const long = `name: demo\ndescription: >\n  ${"x".repeat(1100)}`;
		expect(findSkillFrontmatterViolations("packages/demo/SKILL.md", wrap(long))).toEqual([
			new CheckViolation("packages/demo/SKILL.md", 3, "description-length", "description is 1100 chars (max 1024)"),
		]);
	});

	it("skips a file that cannot be read and still checks the rest", () => {
		const violations = checkSkillFrontmatter(["missing/SKILL.md", "packages/demo/SKILL.md"], (file) => {
			if (file === "missing/SKILL.md") throw new Error("ENOENT");
			return "# No frontmatter\n";
		});

		expect(violations).toEqual([
			new CheckViolation(
				"packages/demo/SKILL.md",
				1,
				"frontmatter-block",
				"missing or unterminated --- frontmatter block",
			),
		]);
	});
});

describe("layered quality gates", () => {
	it("plans the staged fast gate as private keys, conflict markers, and read-only Biome", () => {
		expect(createFastCheckPlan()).toEqual([
			["run", "scripts/quality/check-private-keys.mjs", "--staged"],
			["run", "scripts/quality/check-conflict-markers.mjs", "--staged"],
			["x", "@biomejs/biome", "check", "--error-on-warnings", "--staged", "--no-errors-on-unmatched"],
		]);
	});

	it("plans the architecture gate as the YAML engine only", () => {
		expect(createArchitectureCheckPlan()).toEqual([
			["run", "scripts/quality/check-package-boundaries.mjs"],
			["run", "scripts/quality/check-coding-agent-architecture.mjs"],
		]);
	});

	it("keeps CI on the full check and adds fast, arch, and full beside it", () => {
		const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;
		const workflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8");

		expect(scripts["check:fast"]).toBe("bun run scripts/quality/check-fast.mjs");
		expect(scripts["check:arch"]).toBe("bun run scripts/quality/check-architecture.mjs");
		expect(scripts["check:full"]).toBe(
			'concurrently --names "lint,types,guards" --prefix-colors "cyan,yellow,magenta" "bun run check:lint:full" "bun run check:types" "bun run check:guards"',
		);
		expect(scripts.check).toContain("bun run check:guards");
		expect(scripts.check).not.toContain("apps/mobile");
		expect(scripts.check).not.toContain("check:arch");
		expect(scripts["check:full"]).toContain("check:guards");
		expect(workflow).toContain("run: bun run check:full\n");
	});

	it("reports a conflict marker in a changed file and skips private-key exclusions", () => {
		const begin = "-----BEGIN ";
		const seen = [];
		const lines = [];
		const reporters = {
			log: (line) => lines.push(line),
			error: (line) => lines.push(line),
		};
		const code = runChangedFileGuards(
			["packages/ai/src/index.ts", "docs/example.md", "apps/desktop/icon.png", "scripts/quality/lib.mjs"],
			(file) => {
				seen.push(file);
				if (file.startsWith("docs/")) return `${begin}RSA PRIVATE KEY-----\n`;
				if (file.startsWith("packages/")) return "<<<<<<< HEAD\n";
				return "ok\n";
			},
			reporters,
		);

		expect(code).toBe(1);
		expect(lines).toContain(
			"[conflict-markers] packages/ai/src/index.ts:1: unresolved conflict marker (conflict-marker)",
		);
		expect(lines.some((line) => line.includes("private-key") && line.includes("docs/example.md"))).toBe(false);
		expect(lines.some((line) => line.includes("icon.png"))).toBe(false);
		expect(seen.filter((file) => file.startsWith("docs/"))).toEqual(["docs/example.md"]);
		expect(seen.filter((file) => file.startsWith("scripts/quality/"))).toEqual(["scripts/quality/lib.mjs"]);
		expect(seen.filter((file) => file.startsWith("packages/"))).toEqual([
			"packages/ai/src/index.ts",
			"packages/ai/src/index.ts",
		]);
		expect(selectPrivateKeyFiles(["docs/example.md", "packages/ai/src/index.ts", "apps/desktop/icon.png"])).toEqual([
			"packages/ai/src/index.ts",
		]);
	});

	it("passes fast guards when the changed files are clean", () => {
		const lines = [];
		const code = runChangedFileGuards(["packages/ai/src/index.ts"], () => "export const value = 1;\n", {
			log: (line) => lines.push(line),
			error: (line) => lines.push(line),
		});

		expect(code).toBe(0);
		expect(lines).toEqual(["[private-key] passed", "[conflict-markers] passed"]);
	});

	it("runs check:quick on one file without the architecture engine", () => {
		const result = spawnSync("bun", ["run", "scripts/quality/check-quick.mjs", "--", "scripts/quality/lib.mjs"], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

		expect(result.status).toBe(0);
		expect(output).toContain("[private-key] passed");
		expect(output).toContain("[conflict-markers] passed");
		expect(output).not.toContain("[package-boundaries]");
		expect(output).not.toContain("[coding-agent-architecture]");
		expect(output).not.toContain("check:guards");
	});
});

describe("package boundary parallel scan", () => {
	it("keeps one worker below 64 files and caps a large scan at two", () => {
		expect(boundaryWorkerCount(10, 8)).toBe(1);
		expect(boundaryWorkerCount(100, 1)).toBe(1);
		expect(boundaryWorkerCount(100, 8)).toBe(2);
		expect(boundaryWorkerCount(3, 8)).toBe(1);
	});

	it("round-robins jobs and merges findings back into walk order", () => {
		const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
		expect(partitionBoundaryJobs(jobs, 2)).toEqual([
			[{ id: "a" }, { id: "c" }, { id: "e" }],
			[{ id: "b" }, { id: "d" }],
		]);
		expect(() => partitionBoundaryJobs(jobs, 0)).toThrow("worker count must be a positive integer");
		expect(
			mergeBoundaryItems([
				{ index: 2, scanned: 1, findings: [{ file: "c.ts", line: 1 }] },
				{ index: 0, scanned: 0, findings: [{ file: "manifest", line: 1 }] },
				{ index: 1, scanned: 1, findings: [] },
			]),
		).toEqual({
			findings: [
				{ file: "manifest", line: 1 },
				{ file: "c.ts", line: 1 },
			],
			scanned: 2,
		});
	});

	it("lists the tsconfig entry and drops skipped trees", () => {
		const scan = collectBoundaryScan();
		const indexes = [...scan.jobs, ...scan.inline].map((item) => item.index);

		expect(scan.jobs.some((job) => job.entry && job.file === "tsconfig.json")).toBe(true);
		expect(scan.jobs.some((job) => job.file.includes("/examples/"))).toBe(false);
		expect(scan.jobs.some((job) => job.file.includes("/dist/"))).toBe(false);
		expect(new Set(indexes).size).toBe(indexes.length);
	});

	it("reports the line of an app import and a raw capability id", () => {
		const document = loadBoundaryDocument(join(repoRoot, "scripts/quality/rules/package-boundaries.yml"));
		const file = "packages/ai/src/example.ts";

		expect(
			evaluateBoundaryFile(document, file, 'import "@vetta/desktop";\n').map((finding) => [
				finding.line,
				finding.rule,
			]),
		).toContainEqual([1, "libs-must-not-depend-on-apps"]);
		expect(
			evaluateBoundaryFile(document, file, 'const ok = "cap";\nconst id = "cap.domain.vetta.example.read";\n').map(
				(finding) => [finding.line, finding.rule],
			),
		).toContainEqual([2, "no-raw-capability-ids"]);
	});

	it("keeps coding-agent import edges and does not parse again when the AST cache is warm", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-coding-agent-cache-"));
		const relativePath = "packages/coding-agent/src/example.ts";
		const text =
			'import { read as load } from "@vetta/runtime-storage/conversation";\nexport { value } from "./local.js";\n';
		try {
			mkdirSync(join(root, "packages", "coding-agent", "src"), { recursive: true });
			writeFileSync(join(root, relativePath), text);
			const cache = createAstCache({ root, cacheDir: join(root, "quality-cache") });
			const input = {
				files: [{ path: relativePath, text }],
				packageJson: { exports: { ".": "./dist/index.js" } },
			};
			const first = collectCodingAgentArchitectureState(input, "packages/coding-agent/src", cache);
			const second = collectCodingAgentArchitectureState(input, "packages/coding-agent/src", cache);
			expect(first.edges).toEqual([
				{
					path: relativePath,
					specifier: "@vetta/runtime-storage/conversation",
					kind: "import",
					names: ["read"],
					line: 1,
				},
				{
					path: relativePath,
					specifier: "./local.js",
					kind: "export",
					names: ["value"],
					line: 2,
				},
			]);
			expect(second.edges).toEqual(first.edges);
			expect(cache.stats().parses).toBe(1);
			expect(cache.stats().hits).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps boundary findings and does not parse again when the AST cache is warm", async () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-ast-cache-scan-"));
		const relativePath = "packages/ai/src/example.ts";
		const text = 'import "@vetta/desktop";\n';
		try {
			mkdirSync(join(root, "packages", "ai", "src"), { recursive: true });
			writeFileSync(join(root, relativePath), text);
			const cache = createAstCache({ root, cacheDir: join(root, "quality-cache") });
			const document = loadBoundaryDocument(join(repoRoot, "scripts/quality/rules/package-boundaries.yml"));
			const jobs = [{ index: 0, file: relativePath, manifest: null, entry: true }];
			const readFile = () => text;
			const first = await evaluateBoundaryFileJobs(jobs, { workers: 1, cache, readFile, document });
			const second = await evaluateBoundaryFileJobs(jobs, { workers: 1, cache, readFile, document });
			const overlaid = await evaluateBoundaryFileJobs(jobs, {
				workers: 1,
				cache,
				readFile: () => "export {}\n",
				document,
			});

			expect(first[0].findings.map((finding) => finding.rule)).toContain("libs-must-not-depend-on-apps");
			expect(second).toEqual(first);
			expect(overlaid[0].findings).toEqual([]);
			expect(cache.stats().parses).toBe(1);
			expect(cache.stats().hits).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns the same findings from a worker shard as from the serial scan", async () => {
		const texts = { "packages/ai/src/layered-gate-example.ts": 'import "@vetta/desktop";\n' };
		const jobs = [
			{ index: 1, file: "packages/ai/src/layered-gate-example.ts", manifest: null, entry: false },
			{ index: 0, file: "scripts/quality/lib.mjs", manifest: null, entry: false },
		];
		const readFile = (file) => texts[file] ?? readFileSync(join(repoRoot, file), "utf8");
		const serial = await evaluateBoundaryFileJobs(jobs, { workers: 1, readFile });
		const parallel = await evaluateBoundaryFileJobs(jobs, { workers: 2, texts });

		expect(mergeBoundaryItems(serial).findings.length).toBeGreaterThan(0);
		expect(mergeBoundaryItems(parallel)).toEqual(mergeBoundaryItems(serial));
	});
});
