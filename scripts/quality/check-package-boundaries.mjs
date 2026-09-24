/**
 * Monorepo package boundaries.
 *
 * Rules live in scripts/quality/rules/package-boundaries.yml.
 * The deprecated checker in check-package-boundaries.legacy.mjs is the
 * behavior baseline for the differential test.
 *
 * The file walk runs on several cores. A serial pass of the whole tree is too
 * slow for `check:arch`. Findings stay in walk order.
 *
 * Usage:
 *   bun run scripts/quality/check-package-boundaries.mjs
 */

import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { evaluateBoundaryFile, evaluateBoundaryManifest, loadBoundaryDocument } from "./arch-engine/boundary-rules.mjs";
import { evaluateBoundaryJob, mergeBoundaryItems, partitionBoundaryJobs } from "./arch-engine/boundary-scan.mjs";
import { createAstCache } from "./arch-engine/cache.mjs";
import { CheckViolation, fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const documentPath = join(repoRoot, "scripts/quality/rules/package-boundaries.yml");
let document;

function rules() {
	if (!document) document = loadBoundaryDocument(documentPath);
	return document;
}

export function findPackageBoundaryViolations(posixPath, text, options = {}) {
	return evaluateBoundaryFile(rules(), posixPath, text, options).map(
		(finding) => `${finding.file}: ${finding.message}`,
	);
}

export function findPackageManifestBoundaryViolations(manifest) {
	return evaluateBoundaryManifest(rules(), manifest).map((finding) => finding.text);
}

function manifestRecord(finding) {
	const index = finding.text.indexOf(": ");
	if (index < 0) return { file: finding.text, line: 1, rule: finding.name, message: finding.text, fix: finding.fix };
	return {
		file: finding.text.slice(0, index),
		line: 1,
		rule: finding.name,
		message: finding.text.slice(index + 2),
		fix: finding.fix,
	};
}

/** Below this size the worker startup costs more than the parse. */
export function boundaryWorkerCount(jobCount, cores = availableParallelism()) {
	if (!Number.isInteger(jobCount) || jobCount < 64) return 1;
	if (!Number.isInteger(cores) || cores < 2) return 1;
	// Two workers were faster than four or eight on the machines this gate is timed on.
	// More workers spend the budget on startup and contend for the parser.
	return Math.min(2, cores, jobCount);
}

/**
 * Entry files and root files, plus manifest findings already in walk order.
 * `inline` items use the same index sequence as `jobs`.
 */
export function collectBoundaryScan(spec = rules()) {
	const jobs = [];
	const inline = [];
	let index = 0;
	for (const entry of spec.scan.entryPaths) {
		jobs.push({ index, file: entry, manifest: null, entry: true });
		index += 1;
	}
	for (const root of spec.scan.roots) {
		let manifest = null;
		try {
			manifest = JSON.parse(readText(join(repoRoot, root, "package.json")));
		} catch {
			manifest = null;
		}
		for (const finding of evaluateBoundaryManifest(spec, manifest)) {
			inline.push({ index, scanned: 0, findings: [manifestRecord(finding)] });
			index += 1;
		}
		for (const file of walkFiles(join(repoRoot, root))) {
			const posixPath = rel(file);
			if (spec.scan.skipContains.some((part) => posixPath.includes(part))) continue;
			jobs.push({ index, file: posixPath, manifest, entry: false });
			index += 1;
		}
	}
	return { jobs, inline };
}

function packBoundaryJobs(jobs) {
	const manifests = [];
	const ids = new Map();
	const packed = jobs.map((job) => {
		let manifestId = -1;
		if (job.manifest) {
			const existing = ids.get(job.manifest);
			if (existing === undefined) {
				manifestId = manifests.length;
				manifests.push(job.manifest);
				ids.set(job.manifest, manifestId);
			} else {
				manifestId = existing;
			}
		}
		return { index: job.index, file: job.file, entry: job.entry === true, manifestId };
	});
	return { manifests, jobs: packed };
}

function runBoundaryShard(workerPath, payload) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(workerPath, { workerData: payload });
		let settled = false;
		const finish = (settle, value) => {
			if (settled) return;
			settled = true;
			settle(value);
		};
		worker.once("message", (message) => {
			if (!message || typeof message !== "object") {
				finish(reject, new Error("boundary scan worker returned no items"));
				return;
			}
			if (message.error) {
				finish(reject, new Error(message.error));
				return;
			}
			if (!Array.isArray(message.items)) {
				finish(reject, new Error("boundary scan worker returned no items"));
				return;
			}
			finish(resolve, message.items);
		});
		worker.once("error", (error) => finish(reject, error));
		worker.once("exit", (code) => {
			if (code !== 0) finish(reject, new Error(`boundary scan worker exited ${code}`));
		});
	});
}

/**
 * `readFile` is used on the serial path. Workers cannot receive a function;
 * pass `texts` to override sources there.
 */
export async function evaluateBoundaryFileJobs(jobs, options = {}) {
	const workers = options.workers ?? boundaryWorkerCount(jobs.length);
	if (workers <= 1) {
		const document = options.document ?? rules();
		const readFile = options.readFile ?? ((file) => readText(join(repoRoot, file)));
		return jobs.map((job) => evaluateBoundaryJob(document, job, readFile, options.cache ?? null));
	}
	const packed = packBoundaryJobs(jobs);
	const shards = partitionBoundaryJobs(packed.jobs, workers);
	const workerPath = fileURLToPath(new URL("./arch-engine/boundary-scan-worker.mjs", import.meta.url));
	const parts = await Promise.all(
		shards.map((shard) =>
			runBoundaryShard(workerPath, {
				documentPath,
				repoRoot: options.cache?.root ?? repoRoot,
				cacheDir: options.cache?.cacheDir ?? null,
				manifests: packed.manifests,
				jobs: shard,
				texts: options.texts ?? null,
			}),
		),
	);
	return parts.flat();
}

async function scanBoundaries() {
	const spec = rules();
	const { jobs, inline } = collectBoundaryScan(spec);
	const fileItems = await evaluateBoundaryFileJobs(jobs, { document: spec, cache: createAstCache() });
	const { findings, scanned } = mergeBoundaryItems([...inline, ...fileItems]);
	if (findings.length === 0) {
		ok(`[package-boundaries] ok (${scanned} file(s) scanned)`);
		return 0;
	}
	for (const finding of findings) {
		const violation = new CheckViolation(finding.file, finding.line, finding.rule, finding.message);
		fail(violation.format("package-boundaries"));
		if (finding.fix) fail(`[package-boundaries] fix: ${finding.fix}`);
	}
	fail(`[package-boundaries] ${findings.length} violation(s)`);
	return 1;
}

export async function main() {
	try {
		return await scanBoundaries();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(`[package-boundaries] internal error: ${message}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	main().then((code) => {
		process.exit(code);
	});
}
