/**
 * Fail on unresolved git conflict markers in sources.
 *
 * Usage:
 *   bun run scripts/quality/check-conflict-markers.mjs
 *   bun run scripts/quality/check-conflict-markers.mjs --staged
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	CheckViolation,
	collectFileViolations,
	isBinaryLike,
	isDirectRun,
	readText,
	rel,
	repoRoot,
	runCheck,
	stagedFiles,
	walkFiles,
} from "./lib.mjs";

function isConflictMarkerLine(line) {
	const text = line.endsWith("\r") ? line.slice(0, -1) : line;
	return text.startsWith("<<<<<<< ") || text.startsWith(">>>>>>> ") || text === "=======";
}

/** Marker lines in one file. `file` is the path printed in the guard message. */
export function findConflictMarkerViolationsInText(file, text) {
	const violations = [];
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		if (!isConflictMarkerLine(lines[index])) continue;
		violations.push(new CheckViolation(file, index + 1, "conflict-marker", "unresolved conflict marker"));
	}
	return violations;
}

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return stagedFiles().filter((file) => existsSync(join(repoRoot, file)) && !isBinaryLike(file));
	}
	const roots = ["packages", "apps", "scripts"].map((dir) => join(repoRoot, dir));
	const files = [];
	for (const root of roots) files.push(...walkFiles(root));
	return files
		.map((file) => rel(file))
		.filter(
			(file) =>
				!file.includes("/node_modules/") &&
				!file.includes("/dist/") &&
				!file.includes("/.next/") &&
				!file.includes("/coverage/"),
		);
}

/** Read each repo-relative path and return marker violations. A file that cannot be read is skipped. */
export function checkConflictMarkers(files, readFile = (file) => readText(join(repoRoot, file))) {
	return collectFileViolations(files, findConflictMarkerViolationsInText, readFile);
}

export function main(argv = process.argv) {
	const stagedOnly = argv.includes("--staged");
	return runCheck("conflict-markers", () => checkConflictMarkers(collectTargets(stagedOnly)));
}

if (isDirectRun(import.meta.url)) {
	process.exitCode = main();
}
