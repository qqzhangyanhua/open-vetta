/**
 * File AST cache for architecture guards.
 *
 * Every load reads the file and hashes it. A matching mtime alone is not a
 * hit: a same-length edit can put the old timestamp back. A changed mtime
 * still reparses when the hash matches, so a touch cannot keep the previous
 * cache identity. The saved work is TypeScript parsing, not the read.
 *
 * Entries are JSON files under `<cacheDir>/ast`, default `<root>/.cache/quality/ast`.
 * mtime is compared after rounding to milliseconds. Returned trees are owned
 * by the cache; callers treat them as read-only. In-process hits ignore a
 * deleted cache directory until the process exits.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeRepoPath, repoRoot } from "../lib.mjs";
import { AST_FORMAT_VERSION, parseSource } from "./ast-walker.mjs";

function pathErrorCode(error) {
	return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function contentHash(text) {
	return createHash("sha256").update(text).digest("hex");
}

function isCacheRecord(value, relativePath) {
	if (!value || typeof value !== "object") return false;
	if (value.version !== AST_FORMAT_VERSION) return false;
	if (value.path !== relativePath) return false;
	if (typeof value.hash !== "string" || typeof value.mtimeMs !== "number") return false;
	return Boolean(value.ast && value.ast.kind === "SourceFile");
}

function classify(cached, hash, mtimeMs) {
	if (!cached) return "miss";
	if (cached.hash !== hash) return "hash";
	if (cached.mtimeMs !== mtimeMs) return "mtime";
	return "hit";
}

export function createAstCache({ root = repoRoot, cacheDir } = {}) {
	const resolvedRoot = resolve(root);
	const directory = resolve(cacheDir ?? join(resolvedRoot, ".cache", "quality"));
	const astDirectory = join(directory, "ast");
	const memory = new Map();
	const counts = {
		hits: 0,
		misses: 0,
		mtimeInvalidations: 0,
		hashInvalidations: 0,
		parses: 0,
	};

	function recordPath(relativePath) {
		return join(astDirectory, `${createHash("sha256").update(relativePath).digest("hex")}.json`);
	}

	function readCached(relativePath) {
		const stored = memory.get(relativePath);
		if (stored) return stored;
		const file = recordPath(relativePath);
		if (!existsSync(file)) return null;
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8"));
			if (!isCacheRecord(parsed, relativePath)) return null;
			memory.set(relativePath, parsed);
			return parsed;
		} catch {
			// A torn or stale file is a miss. The next store overwrites it.
			return null;
		}
	}

	function store(relativePath, text, identity) {
		counts.parses += 1;
		const record = {
			version: AST_FORMAT_VERSION,
			path: relativePath,
			hash: identity.hash,
			mtimeMs: identity.mtimeMs,
			ast: parseSource(relativePath, text),
		};
		memory.set(relativePath, record);
		mkdirSync(astDirectory, { recursive: true });
		writeFileSync(recordPath(relativePath), JSON.stringify(record));
		return record.ast;
	}

	function load(filePath) {
		const relativePath = normalizeRepoPath(filePath, resolvedRoot);
		const absolute = join(resolvedRoot, relativePath);
		let fileStat;
		try {
			fileStat = statSync(absolute);
		} catch (error) {
			const code = pathErrorCode(error) ?? "unknown";
			throw new Error(`unable to read source file: ${relativePath} (${code})`);
		}
		if (!fileStat.isFile()) throw new Error(`unable to read source file: ${relativePath} (not a file)`);
		const text = readFileSync(absolute, "utf8");
		const identity = {
			hash: contentHash(text),
			mtimeMs: Math.round(fileStat.mtimeMs),
		};
		const cached = readCached(relativePath);
		const outcome = classify(cached, identity.hash, identity.mtimeMs);
		if (outcome === "hit") {
			counts.hits += 1;
			return cached.ast;
		}
		if (outcome === "hash") counts.hashInvalidations += 1;
		else if (outcome === "mtime") counts.mtimeInvalidations += 1;
		else counts.misses += 1;
		return store(relativePath, text, identity);
	}

	function stats() {
		const total = counts.hits + counts.misses + counts.mtimeInvalidations + counts.hashInvalidations;
		return {
			...counts,
			hitRate: total === 0 ? 0 : counts.hits / total,
		};
	}

	/** AST for `text` when it is exactly the file on disk. Synthetic text returns null. */
	function astFor(filePath, text) {
		if (typeof text !== "string") return null;
		let relativePath;
		try {
			relativePath = normalizeRepoPath(filePath, resolvedRoot);
		} catch {
			return null;
		}
		let disk;
		try {
			disk = readFileSync(join(resolvedRoot, relativePath), "utf8");
		} catch {
			return null;
		}
		if (disk !== text) return null;
		return load(relativePath);
	}

	return { load, stats, astFor, root: resolvedRoot, cacheDir: directory };
}
