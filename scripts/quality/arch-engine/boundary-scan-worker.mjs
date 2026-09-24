/**
 * One shard of the package-boundary scan.
 * The parent process assigns indexes and prints findings in walk order.
 */

import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { readText } from "../lib.mjs";
import { loadBoundaryDocument } from "./boundary-rules.mjs";
import { evaluateBoundaryJob } from "./boundary-scan.mjs";
import { createAstCache } from "./cache.mjs";

if (!parentPort) {
	throw new Error("boundary scan worker must be started with worker_threads");
}

function readFile(file) {
	if (workerData.texts && Object.hasOwn(workerData.texts, file)) return workerData.texts[file];
	return readText(join(workerData.repoRoot, file));
}

try {
	const document = loadBoundaryDocument(workerData.documentPath);
	const manifests = workerData.manifests ?? [];
	const cache = workerData.cacheDir
		? createAstCache({ root: workerData.repoRoot, cacheDir: workerData.cacheDir })
		: null;
	const items = workerData.jobs.map((job) =>
		evaluateBoundaryJob(
			document,
			{
				index: job.index,
				file: job.file,
				entry: job.entry === true,
				manifest: job.manifestId < 0 ? undefined : manifests[job.manifestId],
			},
			readFile,
			cache,
		),
	);
	parentPort.postMessage({ items });
} catch (error) {
	parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
