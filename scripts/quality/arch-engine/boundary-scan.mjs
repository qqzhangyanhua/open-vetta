/**
 * Shared package-boundary scan steps.
 *
 * The serial walk and the worker shards both call `evaluateBoundaryJob`,
 * so a file is either skipped or reported the same way on every core.
 * `texts` exists because a function cannot cross the worker boundary.
 */

import { join } from "node:path";
import { readText, repoRoot } from "../lib.mjs";
import { evaluateBoundaryFile } from "./boundary-rules.mjs";

export function partitionBoundaryJobs(jobs, workerCount) {
	if (!Number.isInteger(workerCount) || workerCount < 1) {
		throw new Error("worker count must be a positive integer");
	}
	const shards = Array.from({ length: workerCount }, () => []);
	for (let index = 0; index < jobs.length; index += 1) {
		shards[index % workerCount].push(jobs[index]);
	}
	return shards.filter((shard) => shard.length > 0);
}

/** Findings follow `index`, which is the serial walk order. */
export function mergeBoundaryItems(items) {
	const ordered = [...items].sort((left, right) => left.index - right.index);
	const findings = [];
	let scanned = 0;
	for (const item of ordered) {
		scanned += item.scanned;
		findings.push(...item.findings);
	}
	return { findings, scanned };
}

export function evaluateBoundaryJob(document, job, readFile = (file) => readText(join(repoRoot, file))) {
	let text;
	try {
		text = readFile(job.file);
	} catch (error) {
		if (job.entry) throw error;
		return { index: job.index, scanned: 0, findings: [] };
	}
	return {
		index: job.index,
		scanned: 1,
		findings: evaluateBoundaryFile(document, job.file, text, { manifest: job.manifest ?? undefined }),
	};
}
