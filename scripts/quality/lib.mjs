/**
 * Shared helpers for quality-gate scripts.
 * Keep these dependency-free (Node/Bun built-ins only).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = process.cwd();

/** Normalize separators to `/`, including Windows paths observed on POSIX. */
export function toPosix(p) {
	return p.replaceAll("\\", "/");
}

function workspaceKey(directory) {
	const parts = toPosix(directory).split("/");
	if (parts[0] === "packages" && parts[1] === "plugins") {
		if ((parts[2] === "presets" || parts[2] === "externals") && parts[3]) {
			return `${parts[2]}/${parts[3]}`;
		}
		return parts[2];
	}
	if (parts[0] === "packages" && parts[1] === "themes" && parts[2] === "builtin" && parts[3]) {
		return `themes/${parts[3]}`;
	}
	return parts.length > 2 ? parts.slice(1).join("/") : parts[1];
}

function expandWorkspacePattern(pattern, root = repoRoot) {
	const normalized = toPosix(pattern);
	if (!normalized.includes("*")) return [normalized];
	const segments = normalized.split("/");
	let directories = [""];
	for (const segment of segments) {
		if (segment !== "*") {
			directories = directories.map((directory) => (directory ? `${directory}/${segment}` : segment));
			continue;
		}
		directories = directories.flatMap((directory) => {
			const absolute = join(root, directory);
			if (!existsSync(absolute)) return [];
			return readdirSync(absolute, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => `${directory}/${entry.name}`)
				.sort();
		});
	}
	return directories;
}

const workspacePackagesByRoot = new Map();
const workspacesBySpecificityByRoot = new Map();

function cacheKeyForRoot(root) {
	return resolve(root);
}

function scanWorkspacePackages(root) {
	const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const packages = [];
	const keys = new Set();
	for (const pattern of rootManifest.workspaces ?? []) {
		for (const dir of expandWorkspacePattern(pattern, root)) {
			const packagePath = join(root, dir, "package.json");
			if (!existsSync(packagePath)) continue;
			const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
			const key = workspaceKey(dir);
			if (!key || keys.has(key)) throw new Error(`duplicate or invalid workspace key for ${dir}: ${key ?? ""}`);
			keys.add(key);
			packages.push({
				key,
				dir,
				name: manifest.name,
				scripts: manifest.scripts ?? {},
				dependencies: {
					...manifest.dependencies,
					...manifest.devDependencies,
					...manifest.optionalDependencies,
					...manifest.peerDependencies,
				},
			});
		}
	}
	return packages;
}

/** Workspace manifests are the single source of truth for package discovery and dependency propagation. Scans once per resolved root. */
export function discoverWorkspacePackages(root = repoRoot) {
	const cacheKey = cacheKeyForRoot(root);
	const cached = workspacePackagesByRoot.get(cacheKey);
	if (cached) return cached;
	const packages = scanWorkspacePackages(root);
	workspacePackagesByRoot.set(cacheKey, packages);
	return packages;
}

/** Workspace list ordered so nested directories match before their parents. */
export function getWorkspacesBySpecificity(root = repoRoot) {
	const cacheKey = cacheKeyForRoot(root);
	const cached = workspacesBySpecificityByRoot.get(cacheKey);
	if (cached) return cached;
	const sorted = [...discoverWorkspacePackages(root)].sort((left, right) => right.dir.length - left.dir.length);
	workspacesBySpecificityByRoot.set(cacheKey, sorted);
	return sorted;
}

export function workspaceForFile(file, root = repoRoot) {
	const norm = toPosix(file);
	return getWorkspacesBySpecificity(root).find((pkg) => norm === pkg.dir || norm.startsWith(`${pkg.dir}/`));
}

export const WORKSPACE_PACKAGES = discoverWorkspacePackages();

/** Every workspace that declares a `test` script, derived rather than manually registered. */
export const TESTABLE_PACKAGES = Object.fromEntries(
	WORKSPACE_PACKAGES.filter((pkg) => Boolean(pkg.scripts.test)).map((pkg) => [pkg.key, pkg.dir]),
);

/** Short name → directory for common workspace packages. */
export const PACKAGE_DIRS = {
	...Object.fromEntries(WORKSPACE_PACKAGES.map((pkg) => [pkg.key, pkg.dir])),
	"im-gateway": "apps/im-gateway",
};

export function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

/**
 * One guard finding. `severity` is recorded for later migrations;
 * `runCheck` still returns 1 when any violation is returned.
 */
export class CheckViolation {
	constructor(file, line, rule, message, severity = "error") {
		this.file = file;
		this.line = line;
		this.rule = rule;
		this.message = message;
		this.severity = severity;
	}

	format(guardName) {
		return `[${guardName}] ${this.file}:${this.line}: ${this.message} (${this.rule})`;
	}
}

/**
 * Run a guard and return its status code.
 * Does not call `process.exit` or set `process.exitCode`; the direct-run
 * entry assigns the returned code once so tests can capture the result.
 *
 * @param {string} name
 * @param {() => CheckViolation[]} checkFn
 * @param {{ log?: (message: string) => void, error?: (message: string) => void }} [reporters]
 * @returns {0 | 1}
 */
export function runCheck(name, checkFn, reporters = {}) {
	const log = reporters.log ?? console.log;
	const error = reporters.error ?? console.error;
	try {
		const violations = checkFn();
		if (violations.length > 0) {
			for (const violation of violations) error(violation.format(name));
			return 1;
		}
		log(`[${name}] passed`);
		return 0;
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : String(caught);
		error(`[${name}] internal error: ${message}`);
		return 1;
	}
}

/**
 * Read each path and append findings from `findInText(file, text)`.
 * Unreadable files are skipped. A guard that must fail closed on a read error should not use this.
 *
 * @param {string[]} files
 * @param {(file: string, text: string) => CheckViolation[]} findInText
 * @param {(file: string) => string} readFile
 */
export function collectFileViolations(files, findInText, readFile) {
	const violations = [];
	for (const file of files) {
		let text;
		try {
			text = readFile(file);
		} catch {
			continue;
		}
		violations.push(...findInText(file, text));
	}
	return violations;
}

/** 1-based line number of a character index. Index 0 and text before the first newline are line 1. */
export function lineNumberAt(text, index) {
	let line = 1;
	const end = Math.min(index, text.length);
	for (let cursor = 0; cursor < end; cursor += 1) {
		if (text.charCodeAt(cursor) === 10) line += 1;
	}
	return line;
}

export function ok(message) {
	console.log(message);
}

export function formatElapsedTime(milliseconds) {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) {
		throw new Error("elapsed time must be a non-negative finite number");
	}
	return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

export function git(args, { allowFail = false } = {}) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		shell: false,
	});
	if (result.status !== 0 && !allowFail) {
		const err = (result.stderr || result.stdout || "").trim();
		throw new Error(`git ${args.join(" ")} failed: ${err || `exit ${result.status}`}`);
	}
	return (result.stdout || "").trim();
}

export function stagedFiles(gitImpl = git) {
	const out = gitImpl(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { allowFail: true });
	if (!out) return [];
	return out.split("\0").filter(Boolean);
}

export function changedFiles(baseRef = "origin/dev", gitImpl = git) {
	const mergeBase = gitImpl(["merge-base", "HEAD", baseRef]);
	const committed = gitImpl(["diff", "--name-only", "-z", `${mergeBase}...HEAD`]);
	const workingTree = gitImpl(["diff", "--name-only", "-z", "HEAD"]);
	const untracked = gitImpl(["ls-files", "--others", "--exclude-standard", "-z"]);

	return [committed, workingTree, untracked]
		.flatMap((output) => output.split("\0"))
		.filter(Boolean)
		.filter((file, index, files) => files.indexOf(file) === index)
		.sort();
}

export function parseBaseArgs(args, defaultBase = "origin/dev") {
	let base = defaultBase;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--base") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) throw new Error("--base requires a git ref");
			base = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("--base=")) {
			base = arg.slice("--base=".length);
			if (!base) throw new Error("--base requires a git ref");
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return { base };
}

function pathErrorCode(error) {
	return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function outsideRepository(absolute, root) {
	const relativePath = relative(root, absolute);
	return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

/**
 * Resolve symlinks for the containment check.
 * ENOENT and ENOTDIR walk upward so a missing suffix, or a suffix below a file,
 * stays lexical. A loop has no provable target.
 */
function realPathForContainment(absolute) {
	const missing = [];
	let current = absolute;
	while (true) {
		try {
			const real = realpathSync(current);
			return missing.length === 0 ? real : join(real, ...missing);
		} catch (error) {
			const code = pathErrorCode(error);
			if (code === "ELOOP") return null;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
		}
		const parent = dirname(current);
		if (parent === current) return absolute;
		missing.unshift(basename(current));
		current = parent;
	}
}

export function normalizeRepoPath(input, root = repoRoot) {
	if (typeof input !== "string" || input.length === 0) throw new Error("file path must be non-empty");
	// The returned path stays the lexical name the caller passed. `..` is collapsed
	// first. Symlinks are followed only to reject a real path that leaves the repository.
	const absolute = resolve(root, toPosix(input));
	const lexicalRelative = relative(root, absolute);
	let escaped = lexicalRelative === "" || outsideRepository(absolute, root);
	if (!escaped) {
		const realAbsolute = realPathForContainment(absolute);
		escaped = realAbsolute === null || outsideRepository(realAbsolute, realpathSync(root));
	}
	if (escaped) throw new Error(`file path must stay inside the repository: ${input}`);
	return toPosix(lexicalRelative);
}

/** Parse a Git base plus optional task-owned files for changed-file quality commands. */
export function parseFileSelectionArgs(args, defaultBase = "origin/dev", root = repoRoot) {
	let base = defaultBase;
	const files = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--") continue;
		if (arg === "--base") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) throw new Error("--base requires a git ref");
			base = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("--base=")) {
			base = arg.slice("--base=".length);
			if (!base) throw new Error("--base requires a git ref");
			continue;
		}
		if (arg === "--file") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) throw new Error("--file requires a repository path");
			files.push(normalizeRepoPath(value, root));
			i += 1;
			continue;
		}
		if (arg.startsWith("--file=")) {
			files.push(normalizeRepoPath(arg.slice("--file=".length), root));
			continue;
		}
		if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
		files.push(normalizeRepoPath(arg, root));
	}
	return { base, files: [...new Set(files)].sort() };
}

export function packagesFromPaths(paths) {
	const found = new Set();
	for (const file of paths) {
		const norm = toPosix(file);
		if (!norm.startsWith("packages/") && !norm.startsWith("apps/")) continue;
		const workspace = workspaceForFile(norm);
		if (workspace) found.add(workspace.key);
	}
	return [...found].sort();
}

/** Include testable packages that transitively depend on any selected workspace package. */
export function expandTestablePackages(names) {
	const metadata = Object.fromEntries(WORKSPACE_PACKAGES.map((pkg) => [pkg.key, pkg]));
	const selected = new Set(names.filter((name) => name in metadata));

	let changed = true;
	while (changed) {
		changed = false;
		const selectedPackageNames = new Set([...selected].map((name) => metadata[name].name));
		for (const [name, pkg] of Object.entries(metadata)) {
			if (selected.has(name)) continue;
			if (Object.keys(pkg.dependencies).some((dependency) => selectedPackageNames.has(dependency))) {
				selected.add(name);
				changed = true;
			}
		}
	}

	return Object.keys(TESTABLE_PACKAGES).filter((name) => selected.has(name));
}

/** Buildable workspace dependencies whose package exports may be consumed by the selected tests. */
export function buildableTestDependencies(names, packages = WORKSPACE_PACKAGES) {
	const byKey = new Map(packages.map((pkg) => [pkg.key, pkg]));
	const byPackageName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const queue = names.map((name) => byKey.get(name)).filter(Boolean);
	const traversed = new Set(queue.map((pkg) => pkg.key));
	const required = new Set();

	for (let index = 0; index < queue.length; index += 1) {
		const pkg = queue[index];
		for (const dependencyName of Object.keys(pkg.dependencies)) {
			const dependency = byPackageName.get(dependencyName);
			if (!dependency) continue;
			required.add(dependency.key);
			if (traversed.has(dependency.key)) continue;
			traversed.add(dependency.key);
			queue.push(dependency);
		}
	}

	return packages.filter((pkg) => required.has(pkg.key) && Boolean(pkg.scripts.build)).map((pkg) => pkg.name);
}

export function walkFiles(dir, { extensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"] } = {}) {
	const results = [];
	if (!existsSync(dir)) return results;

	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				// generated / vendor trees — never scan for quality guards
				if (
					entry.name === "node_modules" ||
					entry.name === "dist" ||
					entry.name === ".git" ||
					entry.name === ".next" ||
					entry.name === "coverage" ||
					entry.name === "out" ||
					entry.name === "build" ||
					entry.name === ".turbo" ||
					entry.name === ".cache" ||
					entry.name === "release" ||
					entry.name === "releases"
				) {
					continue;
				}
				stack.push(full);
				continue;
			}
			// `extensions: null` keeps every file. Callers that only want text still filter afterwards.
			if (extensions == null || extensions.some((ext) => entry.name.endsWith(ext))) {
				results.push(full);
			}
		}
	}
	return results;
}

export function readText(filePath) {
	return readFileSync(filePath, "utf8");
}

export function rel(filePath) {
	return toPosix(relative(repoRoot, filePath));
}

export function runCommand(command, args, { cwd = repoRoot, env } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		stdio: "inherit",
		shell: false,
	});
	return result.status ?? 1;
}

export function runBun(args, options) {
	return runCommand("bun", args, options);
}

/** Run bun argument lists together. The first non-zero status wins; spawn failures are 1. */
export function runBunParallel(argLists) {
	return Promise.all(
		argLists.map(
			(args) =>
				new Promise((resolve) => {
					let settled = false;
					const finish = (code) => {
						if (settled) return;
						settled = true;
						resolve(code);
					};
					const child = spawn("bun", args, {
						cwd: repoRoot,
						stdio: "inherit",
						shell: false,
					});
					child.once("error", () => finish(1));
					child.once("exit", (code) => finish(code ?? 1));
				}),
		),
	).then((codes) => codes.find((code) => code !== 0) ?? 0);
}

export function packageHasTestScript(pkgDir) {
	const pj = join(repoRoot, pkgDir, "package.json");
	if (!existsSync(pj)) return false;
	try {
		const json = JSON.parse(readFileSync(pj, "utf8"));
		return Boolean(json.scripts?.test);
	} catch {
		return false;
	}
}

export function fileSize(filePath) {
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

export function isBinaryLike(filePath) {
	const lower = filePath.toLowerCase();
	return (
		lower.endsWith(".png") ||
		lower.endsWith(".jpg") ||
		lower.endsWith(".jpeg") ||
		lower.endsWith(".gif") ||
		lower.endsWith(".webp") ||
		lower.endsWith(".ico") ||
		lower.endsWith(".woff") ||
		lower.endsWith(".woff2") ||
		lower.endsWith(".ttf") ||
		lower.endsWith(".eot") ||
		lower.endsWith(".zip") ||
		lower.endsWith(".gz") ||
		lower.endsWith(".7z") ||
		lower.endsWith(".exe") ||
		lower.endsWith(".dll") ||
		lower.endsWith(".node") ||
		lower.endsWith(".wasm") ||
		lower.endsWith(".mp4") ||
		lower.endsWith(".mp3") ||
		lower.endsWith(".pdf")
	);
}

export function isDirectRun(moduleUrl, argv = process.argv) {
	if (!argv[1]) return false;
	return resolve(argv[1]) === fileURLToPath(moduleUrl);
}
