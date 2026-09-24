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
import {
	boundaryWorkerCount,
	collectBoundaryScan,
	evaluateBoundaryFileJobs,
	findPackageBoundaryViolations,
	findPackageManifestBoundaryViolations,
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
		expect(createChangedTestPlan(["packages/runtime-core/src/index.ts"]).toTest).toEqual(
			expect.arrayContaining(["runtime-core", "runtime-mcp", "coding-agent", "desktop"]),
		);
		expect(createChangedTestPlan(["apps/desktop/src/main.ts"]).toTest).toEqual(["desktop"]);
	});

	it("runs every core test package for global quality inputs", () => {
		const plan = createChangedTestPlan(["bun.lock", "turbo.json"]);
		expect(plan.globalTriggers).toEqual(["bun.lock", "turbo.json"]);
		expect(plan.runQuality).toBe(true);
		expect(plan.toTest).toEqual(Object.keys(TESTABLE_PACKAGES));
	});

	it("runs quality tests when their implementation changes", () => {
		const plan = createChangedTestPlan(["scripts/quality/test-changed.mjs"]);
		expect(plan.runQuality).toBe(true);
		expect(plan.toTest).toEqual(Object.keys(TESTABLE_PACKAGES));
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
		expect(plan.fallbackChanged).toBe(false);
		expect(plan.targets).toMatchObject([
			{
				key: "ai",
				directTests: ["test/provider-retry-policy.test.ts"],
				relatedSources: ["src/providers/retry-policy.ts"],
				full: false,
			},
		]);
	});

	it("falls back only for root config, deleted files, public entries, and contract directories", () => {
		const root = createImpactTestPlan(["package.json", "packages/ai/src/providers/retry-policy.ts"]);
		expect(root.fallbackChanged).toBe(true);
		expect(root.fallbackReasons).toEqual(["root test configuration changed"]);

		expect(createImpactTestPlan(["packages/ai/src/index.ts"]).fallbackReasons).toEqual([
			"packages/ai/src/index.ts may affect package consumers",
		]);
		expect(
			createImpactTestPlan(["packages/coding-agent/src/composition/contracts/runtime-session-options.ts"])
				.fallbackReasons,
		).toEqual([
			"packages/coding-agent/src/composition/contracts/runtime-session-options.ts may affect package consumers",
		]);
		expect(createImpactTestPlan(["packages/ai/src/public-api/types.ts"], () => true).fallbackReasons).toEqual([
			"packages/ai/src/public-api/types.ts may affect package consumers",
		]);
		expect(createImpactTestPlan(["packages/action-rpc/src/index.ts"]).fallbackReasons).toEqual([
			"packages/action-rpc/src/index.ts may affect package consumers",
		]);

		const deleted = createImpactTestPlan(["packages/ai/src/provider.ts"], () => false);
		expect(deleted.fallbackChanged).toBe(true);
		expect(deleted.targets).toEqual([]);
		expect(deleted.fallbackReasons).toEqual(["packages/ai/src/provider.ts was deleted"]);
		expect(createImpactTestPlan(["packages/action-rpc/src/rpc.ts"], () => false).fallbackReasons).toEqual([
			"packages/action-rpc/src/rpc.ts was deleted",
		]);
	});

	it("keeps package configuration and untested workspaces off the conservative fallback", () => {
		const packageConfig = createImpactTestPlan(["packages/ai/package.json"]);
		expect(packageConfig.fallbackChanged).toBe(false);
		expect(packageConfig.targets).toMatchObject([{ key: "ai", full: true, directTests: [], relatedSources: [] }]);

		const vitestConfig = createImpactTestPlan(["packages/ai/vitest.config.ts"], () => true);
		expect(vitestConfig.fallbackChanged).toBe(false);
		expect(vitestConfig.targets).toMatchObject([
			{ key: "ai", full: false, directTests: [], relatedSources: ["vitest.config.ts"] },
		]);

		const nestedIndex = createImpactTestPlan(["packages/ai/src/providers/index.ts"], () => true);
		expect(nestedIndex.fallbackChanged).toBe(false);
		expect(nestedIndex.targets).toMatchObject([
			{ key: "ai", full: false, relatedSources: ["src/providers/index.ts"] },
		]);

		const untested = createImpactTestPlan(["packages/action-rpc/src/client.ts"]);
		expect(untested.fallbackChanged).toBe(false);
		expect(untested.targets).toEqual([]);
	});

	it("returns an empty impact plan when the file list is empty", () => {
		expect(createImpactTestPlan([])).toEqual({
			files: [],
			fallbackChanged: false,
			fallbackReasons: [],
			runQuality: false,
			targets: [],
		});
	});

	it("keeps more than 100 ordinary sources on Vitest related selection", () => {
		const files = Array.from(
			{ length: 101 },
			(_, index) => `packages/ai/src/impact-bulk/file-${String(index).padStart(3, "0")}.ts`,
		);
		const plan = createImpactTestPlan(files, () => true);

		expect(plan.files).toHaveLength(101);
		expect(plan.fallbackChanged).toBe(false);
		expect(plan.fallbackReasons).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "ai",
				full: false,
				directTests: [],
				relatedSources: files.map((file) => file.slice("packages/ai/".length)),
			},
		]);
	});

	it("falls back when every selected workspace file was deleted", () => {
		const files = ["packages/agent/src/c.ts", "packages/ai/src/a.ts", "packages/ai/src/b.ts"];
		const plan = createImpactTestPlan(files, () => false);

		expect(plan.fallbackChanged).toBe(true);
		expect(plan.targets).toEqual([]);
		expect(plan.fallbackReasons).toEqual([
			"packages/agent/src/c.ts was deleted",
			"packages/ai/src/a.ts was deleted",
			"packages/ai/src/b.ts was deleted",
		]);
	});

	it("runs quality tests for scripts while documentation-only changes need no package tests", () => {
		const quality = createImpactTestPlan(["scripts/quality/test-impact.mjs"]);
		expect(quality).toMatchObject({ runQuality: true, fallbackChanged: false, targets: [] });
		const docs = createImpactTestPlan(["docs/dev/quality-gates.md"]);
		expect(docs).toMatchObject({ runQuality: false, fallbackChanged: false, targets: [] });
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
	const mobileWorkflow = readFileSync(join(repoRoot, ".github/workflows/mobile.yml"), "utf8");
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

	it("runs affected workspace tests on Linux, macOS, and Windows with complete Git history", () => {
		expect(workflow).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
		expect(workflow).toContain("fetch-depth: 0");
		expect(workflow).toContain("command -v rg >/dev/null || { sudo apt-get update");
		expect(workflow).toContain("command -v rg >/dev/null || brew install ripgrep");
		expect(workflow).toContain("Get-Command rg -ErrorAction SilentlyContinue");
		expect(workflow).toContain("bun run test:changed --base");
	});

	it("cancels stale runs, fails the platform matrix fast, and reuses only the exact-lockfile Bun cache", () => {
		expect(workflow).toContain("cancel-in-progress: true");
		expect(workflow).toContain("fail-fast: true");
		expect(workflow.match(/uses: actions\/checkout@v7/g)).toHaveLength(2);
		expect(workflow.match(/uses: \.\/\.github\/actions\/install-bun-dependencies/g)).toHaveLength(2);
		const installAction = readFileSync(join(repoRoot, ".github/actions/install-bun-dependencies/action.yml"), "utf8");
		expect(installAction).not.toContain("node_modules");
		expect(installAction).toContain("~/.bun/install/cache");
		expect(installAction).toContain("bun-downloads-v1-");
		expect(installAction).toContain("hashFiles('bun.lock', 'package.json')");
		expect(installAction).not.toContain("restore-keys");
	});

	it("keeps the local full-test entry point sequential and discovery-based", () => {
		expect(rootManifest.scripts.test).toBe("bun run scripts/quality/test-pkg.mjs --all");
		expect(rootManifest.scripts["test:unit"]).toBe("bun run scripts/quality/test-pkg.mjs --all");
	});

	it("builds the Android app and runs host tests when Kotlin changes", () => {
		expect(kotlinWorkflow).toContain('      - "apps/kotlin/**"');
		expect(kotlinWorkflow).toContain(":shared:testAndroidHostTest");
		expect(kotlinWorkflow).toContain(":androidApp:assembleDebug");
	});

	it("typechecks and exports the Expo app when Mobile changes", () => {
		expect(mobileWorkflow).toContain('      - "apps/mobile/**"');
		expect(mobileWorkflow).toContain("bun run --cwd apps/mobile typecheck");
		expect(mobileWorkflow).toContain("bun run --cwd apps/mobile lint");
		expect(mobileWorkflow).toContain("bun run --cwd apps/mobile export:web");
		expect(rootManifest.scripts["check:types"]).toContain("bun run --cwd apps/mobile typecheck");
		expect(rootManifest.scripts.check).toContain("bun run --cwd apps/mobile lint");
	});

	it("limits path-filtered app checks to branch pushes", () => {
		for (const appWorkflow of [imGatewayWorkflow, kotlinWorkflow, mobileWorkflow]) {
			expect(appWorkflow).toMatch(/push:\r?\n {4}branches:\r?\n {6}- "\*\*"\r?\n {4}paths:/);
		}
	});
});

describe("package boundary analysis", () => {
	const libFile = "packages/ai/src/example.ts";

	it("detects side-effect and dynamic app imports", () => {
		expect(findPackageBoundaryViolations(libFile, 'import "@vetta/desktop";')).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(libFile, 'const app = await import("@vetta/cli-host/runtime");'),
		).toHaveLength(1);
	});

	it("flags a dynamic import that also passes import attributes", () => {
		const imported = 'const app = await import("@vetta/desktop", { with: { type: "json" } });';
		const required = 'const app = require("@vetta/desktop", true);';
		const expected = [`${libFile}: libs/plugins must not import app package (@vetta/desktop)`];
		expect(findPackageBoundaryViolations(libFile, imported)).toEqual(expected);
		expect(findPackageBoundaryViolations(libFile, required)).toEqual(expected);
	});

	it("ignores import-looking comments", () => {
		expect(findPackageBoundaryViolations(libFile, '// import app from "@vetta/desktop";')).toEqual([]);
	});

	it("blocks production imports from test trees but allows test files", () => {
		const source = 'import { fixture } from "../../agent/test/fixture";';
		expect(findPackageBoundaryViolations(libFile, source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/ai/src/example.test.ts", source)).toEqual([]);
	});

	it("allows raw capability ids only in capability definition modules", () => {
		const source = 'const id = "cap.domain.vetta.example.read";';
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/domain/example.ts", source)).toEqual([]);
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/adapters/example.ts", source)).toHaveLength(1);
	});

	it("requires schema-backed capability definitions with generated catalogs", () => {
		const source = `
			const TOKEN = defineCapability<Input, Output>({
				parseInput: parse,
				parseOutput: parse,
			});
		`;
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/foundation/example.ts", source)).toHaveLength(
			2,
		);
	});

	it("blocks Desktop globals in ordinary plugins while preserving workbench and security-probe exceptions", () => {
		const source = "window.vetta.fs.readFile(path);";
		expect(findPackageBoundaryViolations("packages/plugins/externals/example/src/index.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/plugins/presets/plugin-workbench/src/index.ts", source)).toEqual(
			[],
		);
		expect(
			findPackageBoundaryViolations("packages/plugins/externals/security-probe/src/probes/host.ts", source),
		).toEqual([]);
	});

	it("blocks Desktop production imports from cli-host source paths", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/runtime.ts",
				'import { createRuntime } from "../../../../cli-host/src/runtime.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/runtime.ts",
				'import { createRuntime } from "@vetta/runtime-composition";',
			),
		).toHaveLength(1);
	});

	it("keeps the greenfield runtime kernel independent from coding-agent", () => {
		const source = 'import { createCodingAgentPromptRuntime } from "@vetta/coding-agent/runtime-host";';
		expect(findPackageBoundaryViolations("packages/runtime-core/src/kernel/example.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-storage/src/conversation/example.ts", source),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-tools/src/coding/example.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-mcp/src/example.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-core/src/runtime-host/greenfield-session-projection.ts",
				source,
			),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/example.ts", source)).toHaveLength(
			1,
		);
	});

	it("keeps every runtime-core production module independent from coding-agent", () => {
		const source = 'import { SessionManager } from "@vetta/coding-agent";';
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/runtime-host.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/session-services.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/legacy-session-services.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/coding-agent/src/adapters/runtime-core/composition.ts", source),
		).toEqual([]);
	});

	it("keeps the retired Coding Agent Runtime Host public resolution deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/test/example.test.ts",
				'import { createHost } from "@vetta/coding-agent/runtime-host/greenfield";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/vitest.config.ts",
				'const alias = { "@vetta/coding-agent/runtime-host": "../../packages/coding-agent/src/adapters/runtime-core" };',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/test/example.test.ts",
				'import { createCodingAgentTurnExecutor } from "@vetta/coding-agent/runtime";',
			),
		).toEqual([]);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./runtime-host": "./dist/adapters/runtime-core/index.js" },
			}),
		).toHaveLength(1);
	});

	it("keeps agent-core independent from Runtime and product packages", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/telemetry.ts",
				'import type { RuntimeTracer } from "@vetta/runtime-telemetry";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/engine.ts",
				'import type { RuntimeSession } from "@vetta/runtime-core";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/agent/src/model.ts", 'import type { Model } from "@vetta/ai";'),
		).toEqual([]);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/runtime-telemetry": "workspace:*" },
			}),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/ai": "workspace:*" },
			}),
		).toEqual([]);
	});

	it("keeps greenfield product modules independent from legacy startup symbols", () => {
		const source = "const startup = runLegacyAgentWithBootstrap;";
		expect(findPackageBoundaryViolations("apps/cli-host/src/rpc/runtime-host/runtime-host.ts", source)).toHaveLength(
			1,
		);
		expect(
			findPackageBoundaryViolations("packages/runtime-composition/src/greenfield-runtime-composition.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/coding-agent/src/composition/runtime-composition.ts", source),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("apps/cli-host/src/agent-runtime-selection.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("apps/cli-host/src/legacy-runtime-gateway.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/runtime-composition.ts",
				"// runLegacyAgentWithBootstrap is a compatibility-only entry point.",
			),
		).toEqual([]);
	});

	it("keeps Extension Legacy policy out of Greenfield product modules", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/rpc/runtime-host/runtime-host.ts",
				'const reason = "legacy-extension";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/rpc/runtime-host/runtime-host.ts",
				'const kind = "extension-incompatible";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/agent-runtime-selection.ts",
				'const reason = "legacy-extension";',
			),
		).toHaveLength(1);
	});

	it("keeps automatic Legacy Session execution out of production hosts", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/agent-runtime-selection.ts",
				'const reason = "legacy-session";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/legacy-runtime-gateway.ts",
				'const cause = "session-migration-gap";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/agent-runtime-selection.ts",
				'const kind = "session-incompatible";',
			),
		).toEqual([]);
	});

	it("keeps the retired runtime-composition package and CLI forwarding layer deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-composition/src/index.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-composition/src/new-runtime.ts", "export const runtime = {};"),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/greenfield-runtime-composition.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/index.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/runtime.ts",
				'import type { CodingAgentRuntimeCompositionOptions } from "@vetta/cli-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/desktop",
				dependencies: { "@vetta/runtime-composition": "workspace:*" },
			}),
		).toHaveLength(1);
	});

	it("requires all internal consumers to use explicit coding-agent subpaths", () => {
		const rootImport = 'import { getAgentDir } from "@vetta/coding-agent";';
		expect(findPackageBoundaryViolations("apps/desktop/src/main/new-consumer.ts", rootImport)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/new-consumer.ts",
				'import { getAgentDir } from "@vetta/coding-agent/config";',
			),
		).toEqual([]);
		expect(findPackageBoundaryViolations("apps/desktop/src/main/runtime.ts", rootImport)).toHaveLength(1);
		expect(findPackageBoundaryViolations("apps/desktop/src/main/runtime.test.ts", rootImport)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-core/test/runtime.test.ts", rootImport)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-tools/src/index.ts", rootImport)).toHaveLength(1);
	});

	it("keeps the retired Coding Agent Knowledge surface deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/knowledge/example.ts",
				'import { scanRaws } from "@vetta/coding-agent/knowledge";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/example.ts",
				'import { scanRaws } from "../core/knowledge/store.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/core/knowledge/new-store.ts",
				"export const store = {};",
			),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./knowledge": "./dist/core/knowledge/index.js" },
			}),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/runtime-knowledge",
				exports: { ".": "./dist/index.js" },
			}),
		).toEqual([]);
	});

	it("keeps retired Coding Agent model-context core files and imports deleted", () => {
		for (const name of ["messages", "subconscious", "system-prompt"]) {
			expect(
				findPackageBoundaryViolations(`packages/coding-agent/src/core/${name}.ts`, "export const retired = true;"),
			).toHaveLength(1);
			expect(
				findPackageBoundaryViolations(
					"packages/coding-agent/src/composition/example.ts",
					`import { retired } from "../core/${name}.js";`,
				),
			).toHaveLength(1);
		}
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./core/system-prompt.js": "./dist/core/system-prompt.js" },
			}),
		).toHaveLength(1);
	});

	it("keeps Compaction in its package domain and independent from Session storage implementations", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/core/compaction/compaction.ts",
				"export const retired = true;",
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/example.ts",
				'import { compact } from "../core/compaction/index.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/compaction.ts",
				'import type { SessionEntry } from "../core/session-manager/index.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/compaction.ts",
				'import type { ConversationDocument } from "@vetta/runtime-core/conversation";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/runtime/context-runtime.ts",
				'import type { ContextStrategy } from "@vetta/runtime-core/kernel";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/runtime/context-runtime.ts",
				'import type { SessionManager } from "../core/session-manager/index.js";',
			),
		).toHaveLength(1);
	});

	it("keeps production Legacy imports and Runtime adapters inside explicit compatibility boundaries", () => {
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/legacy-runtime-gateway.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/agent-runtime-selection.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/new-consumer.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/greenfield-runtime/desktop-legacy-execution-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/test/support/legacy-runtime.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-desktop/src/historical-session-format.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/coding-agent-bootstrap.ts",
				'import { runCodingAgentStartupMigrations } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/rpc/cli-session-format-compatibility.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/rpc/runtime-host/runtime-host.ts",
				'import { migrateCodingAgentHistoricalSession } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/new-consumer.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/new-consumer.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/greenfield-runtime/desktop-legacy-execution-compatibility.ts",
				'import { LegacyRuntimeSessionCatalog } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/desktop/src/main/greenfield-runtime/desktop-legacy-session-format-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"apps/cli-host/src/rpc/cli-session-format-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/index.ts",
				'export { LegacyRuntimeSessionCatalog } from "../../sessions/legacy/index.js";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/public-api/historical-sessions.ts",
				'import { LegacyRuntimeSessionCatalog } from "../sessions/legacy/catalog.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/sessions/legacy/catalog.ts",
				'import { createAgentSession } from "../../../core/sdk.js";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/sessions/legacy/catalog.ts",
				'import { SessionManager } from "../../../core/session-manager/index.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/composition.ts",
				"export function createLegacyRuntimeHostOptions() {}",
			),
		).toHaveLength(1);
	});

	it("keeps the Runtime active-session transaction host independent from products and platform implementations", () => {
		const hostPath = "packages/runtime-core/src/runtime-host/active-session-host.ts";
		expect(
			findPackageBoundaryViolations(hostPath, 'import { SessionManager } from "../core/session-manager/index.js";'),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				hostPath,
				'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			),
		).not.toEqual([]);
		expect(findPackageBoundaryViolations(hostPath, "type Runtime = CodingAgentRuntimeComposition;")).toHaveLength(1);
		expect(findPackageBoundaryViolations(hostPath, "type Runtime = RuntimeActiveSessionRuntimePort;")).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				hostPath,
				'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
			),
		).not.toEqual([]);
		expect(findPackageBoundaryViolations(hostPath, 'import { join } from "node:path";')).not.toEqual([]);
		expect(findPackageBoundaryViolations(hostPath, 'const value = Buffer.from("session");')).not.toEqual([]);
		expect(findPackageBoundaryViolations(hostPath, "const cwd = process.cwd();")).not.toEqual([]);
	});

	it("keeps Greenfield session action ports independent from the Extension command API", () => {
		const activeHostPath = "packages/runtime-core/src/runtime-host/active-session-host.ts";
		expect(
			findPackageBoundaryViolations(
				activeHostPath,
				'import type { ExtensionCommandContextActions } from "../core/extensions/types.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/host/session-history/branch-navigation-host.ts",
				'type Options = Parameters<ExtensionCommandContextActions["navigateTree"]>[1];',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/greenfield-extension-command-actions-adapter.ts",
				'import type { ExtensionCommandContextActions } from "../../core/extensions/index.js";',
			),
		).toEqual([]);
	});

	it("keeps Knowledge Processing contracts independent from backend implementations", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/knowledge-processing-session.ts",
				'import type { KnowledgeProcessingSession } from "./legacy-knowledge-processing-session.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/knowledge-processing-contract.ts",
				'import { SessionManager } from "../core/session-manager/index.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/legacy-knowledge-processing-session.ts",
				'import { SessionManager } from "../core/session-manager/index.js";',
			),
		).toEqual([]);
	});

	it("keeps Subagent session assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const runtime = new CodingAgentSubagentRuntime({});
			createCodingAgentSubagentChildHandle({});
			hooks.runSubagentStart({});
			const directory = ".subagents";
			const observation = "subagents_update";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(5);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSubagentSessionAssembly } from "./subagent/session-assembly.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Turn Capability session assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const plugin = new CodingAgentPluginRunOrchestrator({});
			const prompt = new CodingAgentPromptRuntime({});
			const frame = new CodingAgentModelCallFrameComposer({});
			const capabilities = await RuntimeCapabilityComposition.create({});
			await frame.previewSystemPrompt({});
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(5);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentTurnCapabilitySessionAssembly } from "./turn/capability-session-assembly.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Session Resource Lifecycle assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const resources: CodingAgentSessionRuntimeResources = {};
			const sessionCleanup = new RetryableCleanup();
			const hookSessionController = {};
			const background = new CodingAgentBackgroundWorkController();
			resources.createSessionPeripherals = () => ({});
			resources.stateSource = {};
			resources.onConversationContinued = async () => {};
			readActiveToolNames();
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(9);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSessionResourceLifecycle } from "./session-lifecycle/resource-lifecycle.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Composition resource registries and shutdown transactions out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedLifecycle = `
			const sessionValues = new InMemoryCodingAgentSessionValueIndex();
			const sessionMarkers = new InMemoryCodingAgentSessionMarkerIndex();
			const compositionCleanup = new RetryableCleanup();
			const contextRuntimes = new Set();
			const memoryRuntimes = new Set();
			const todoRuntimes = new Set();
			const turnCapabilityAssemblies = new Set();
			const hookSessionDisposers = new Set();
			const ownershipBindings = new Set();
			prepareCompositionCleanup();
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedLifecycle)).toHaveLength(11);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentCompositionShutdown } from "./session-lifecycle/composition-shutdown.js";',
			),
		).toEqual([]);
	});

	it("keeps MCP Session coordination out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedCoordinator = `
			const synchronizer: McpRuntimeToolSynchronizer = createMcpRuntimeToolSynchronizer(source, registry);
			const controller = createMcpDeferredToolController(options);
			mergeMcpSnapshots(base, overlay);
			mergeMcpToolViews(base, overlay);
			refreshAndMergeMcpViews(base, overlay);
			const start = "mcp.reload.start";
			const end = "mcp.reload.end";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedCoordinator)).toHaveLength(8);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentMcpSessionCoordinator } from "./tool-surface/mcp-session-coordinator.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Session initialization transactions out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedInitialization = `
			const rollback = new InitializationRollbackScope();
			const execution = new CodingAgentSessionExecutionRuntime({});
			const configuration = new CodingAgentSessionConfigurationState();
			createCodingAgentSessionResourceLifecycle({});
			createCodingAgentTurnCapabilitySessionAssembly({});
			rollback.defer({ id: "conversation-ownership" });
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedInitialization)).toHaveLength(6);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSessionInitializationTransaction } from "./session-initialization/transaction.js";',
			),
		).toEqual([]);
	});

	it("projects public Composition options into a narrow Session initialization profile", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const transactionPath = "packages/coding-agent/src/composition/session-initialization/transaction.ts";

		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"createCodingAgentSessionInitializationTransaction({ composition: options });",
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`import type { CodingAgentRuntimeCompositionOptions } from "./contracts/index.js";
				const composition = options.composition;`,
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"createCodingAgentSessionInitializationTransaction({ profile: sessionInitializationProfile });",
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`import type { CodingAgentSessionInitializationProfile } from "./profile.js";
				const profile = options.profile;`,
			),
		).toEqual([]);
	});

	it("keeps peripheral and context construction out of the Session initialization transaction", () => {
		const transactionPath = "packages/coding-agent/src/composition/session-initialization/transaction.ts";
		const forbiddenConstructions = [
			"new CodingAgentSessionExecutionRuntime({});",
			"new CodingAgentMemoryRolloverOrchestrator({});",
			"new GreenfieldRuntimeModel({});",
			"new CodingAgentGreenfieldContextRuntime({});",
			"createEcosystemHookRuntime({});",
			"createCodingAgentSubagentSessionAssembly({});",
			"createCodingAgentSpecializedToolRegistrations({});",
			"createSessionPluginRuntime(options);",
		];
		for (const source of forbiddenConstructions) {
			expect(findPackageBoundaryViolations(transactionPath, source)).toHaveLength(1);
		}
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`const peripherals = await createCodingAgentSessionPeripheralAssembly(options);
				const context = createCodingAgentSessionContextAssembly({ peripherals });`,
			),
		).toEqual([]);
	});

	it("keeps Runtime Tool Surface assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedToolSurface = `
			const scopes = CODING_TOOL_SCOPES;
			const order = CODING_AGENT_MODEL_TOOL_ORDER;
			createCodingToolsRuntimeComposition({});
			createCodingAgentMcpSessionCoordinator({});
			adaptCodingAgentToolRegistration({});
			createKbListTagsTool();
			createKbFilterByTagsTool();
			resolveCodingAgentToolActivation({});
			const instruction = "knowledge_mode_instruction";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedToolSurface)).toHaveLength(9);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeToolSurface } from "./tool-surface/runtime-tool-surface.js";',
			),
		).toEqual([]);
	});

	it("exposes Coding Agent Runtime Tools through the abstract Registry port", () => {
		const contractPath = "packages/coding-agent/src/composition/contracts/runtime-composition-result.ts";
		const concreteContract = `
			type Tools = CodingToolsRuntimeComposition;
			type Registry = InMemoryCodingToolRegistry;
			type Compiler = FeatureCompiler;
		`;
		expect(findPackageBoundaryViolations(contractPath, concreteContract)).toHaveLength(3);
		expect(
			findPackageBoundaryViolations(
				contractPath,
				"interface CodingAgentRuntimeToolAccess { readonly registry: CodingToolRegistry; }",
			),
		).toEqual([]);

		const compositionPath = "packages/coding-agent/src/composition/tool-surface/runtime-tools-composition.ts";
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"interface CodingToolsRuntimeComposition { readonly registry: InMemoryCodingToolRegistry; }",
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"interface CodingToolsRuntimeComposition { readonly registry: CodingToolRegistry; }",
			),
		).toEqual([]);
	});

	it("keeps Tool policy declarations out of Adapters and Composition", () => {
		const adapterPath = "packages/coding-agent/src/adapters/runtime-core/model-tool-order.ts";
		const compositionPath = "packages/coding-agent/src/composition/tool-surface/activation-policy.ts";
		const policyPath = "packages/coding-agent/src/tool-policy/activation-policy.ts";
		const adapterPolicy = "export const CODING_AGENT_MODEL_TOOL_ORDER = {};";
		const compositionPolicy = `
			export interface CodingAgentToolAvailability {}
			export function resolveCodingAgentToolActivation() {}
		`;

		expect(findPackageBoundaryViolations(adapterPath, adapterPolicy)).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, compositionPolicy)).toHaveLength(2);
		expect(findPackageBoundaryViolations(policyPath, compositionPolicy)).toEqual([]);
	});

	it("keeps Coding Agent product domains independent from concrete Adapters", () => {
		for (const path of [
			"packages/coding-agent/src/extensions/runtime/extension-tool-runtime.ts",
			"packages/coding-agent/src/memory/memory-controller.ts",
			"packages/coding-agent/src/mcp/runtime/tool-source.ts",
			"packages/coding-agent/src/model-context/model-call-frame-composer.ts",
			"packages/coding-agent/src/plugins/runtime/tool-runtime.ts",
			"packages/coding-agent/src/resources/prompt-resource-resolver.ts",
			"packages/coding-agent/src/sessions/projection/conversation-context-projector.ts",
			"packages/coding-agent/src/features/todo/todo-continuation-source.ts",
		]) {
			expect(
				findPackageBoundaryViolations(path, 'import { Adapter } from "../adapters/runtime-core/example.js";'),
			).toHaveLength(1);
		}
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/model-context/model-call-frame-composer.ts",
				'import type { Port } from "../runtime-contracts/index.js";',
			),
		).toEqual([]);
	});

	it("rejects retired Greenfield identities in the Runtime Prompt contract", () => {
		const path = "packages/runtime-core/src/runtime-host/prompt-contract.ts";
		expect(findPackageBoundaryViolations(path, "export interface GreenfieldPromptAdapter {}")).toHaveLength(1);
		expect(findPackageBoundaryViolations(path, "export interface RuntimePromptAdapter {}")).toEqual([]);
	});

	it("keeps Child Composition isolation policy out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		expect(findPackageBoundaryViolations(compositionPath, "const childComposition = {};")).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, "const childCompositionOptions = {};")).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"const { mcpSource: _mcpSource, createPluginMcpRuntime: _createPluginMcpRuntime, extensionTools: _extensionTools } = options;",
			),
		).toHaveLength(3);
		expect(findPackageBoundaryViolations(compositionPath, "const child = { enableSubagents: false };")).toHaveLength(
			1,
		);
		expect(findPackageBoundaryViolations(compositionPath, "child.backend.create(options);")).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, "child.backend.resume(options);")).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentChildCompositionFactory } from "./subagent/child-composition-policy.js";',
			),
		).toEqual([]);
	});

	it("keeps Runtime Host Controls out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedControls = `
			const sessionHooks = {};
			bindExtensionRunner();
			refreshExtensionTools();
			appendSessionContext();
			deliverSessionContext();
			quiesceSessionBackgroundCommands();
			preserveSessionExecutionContext();
			clearSessionExecutionContext();
			flushMemory();
			indexes.hookSessionControllers.get(id);
			indexes.extensionEventBridges.get(id);
			indexes.resourceContexts.get(id);
			indexes.executionRuntimes.get(id);
			indexes.memoryControllers.get(id);
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedControls)).toHaveLength(14);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeSessionControls } from "./session-lifecycle/session-controls.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeExtensionControls } from "./session-lifecycle/extension-controls.js";',
			),
		).toEqual([]);
	});

	it("keeps Session Host capability declarations out of Composition", () => {
		const compositionPath = "packages/coding-agent/src/composition/session-initialization/peripheral-assembly.ts";
		const executionPath = "packages/coding-agent/src/execution/session/runtime.ts";
		const hostCapabilities = `
			export class CodingAgentSessionExecutionRuntime {}
			export interface CodingAgentSubagentWorkRuntime {}
		`;

		expect(findPackageBoundaryViolations(compositionPath, hostCapabilities)).toHaveLength(2);
		expect(findPackageBoundaryViolations(executionPath, hostCapabilities)).toEqual([]);
	});

	it("requires scoped production packages to declare workspace imports", () => {
		const source = 'import { createRuntime } from "@vetta/runtime-tools/coding";';
		const path = "packages/coding-agent/src/composition/example.ts";
		expect(
			findPackageBoundaryViolations(path, source, {
				manifest: {
					name: "@vetta/coding-agent",
					dependencies: { "@vetta/runtime-tools": "workspace:*" },
				},
			}),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(path, source, {
				manifest: { name: "@vetta/coding-agent" },
			}),
		).toHaveLength(1);
	});

	it("keeps agent-core below runtime and product packages", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/example.ts",
				'import { TurnPipeline } from "@vetta/runtime-core/kernel";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/example.ts",
				'import { createCodingAgent } from "@vetta/coding-agent";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-core/src/kernel/agent-core-turn-engine.ts",
				'import { agentLoopContinue } from "@vetta/agent-core";',
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
			'concurrently --names "lint,types,arch" --prefix-colors "cyan,yellow,magenta" "bun run check:lint" "bun run check:types" "bun run check:arch"',
		);
		expect(scripts.check).toContain("bun run check:guards");
		expect(scripts.check).toContain("bun run --cwd apps/mobile lint");
		expect(scripts.check).not.toContain("check:arch");
		expect(scripts["check:full"]).not.toContain("check:guards");
		expect(workflow).toContain("run: bun run check\n");
		expect(workflow).not.toContain("check:full");
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
