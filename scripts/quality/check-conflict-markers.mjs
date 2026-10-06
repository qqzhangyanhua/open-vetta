/**
 * Fail on unresolved git conflict markers in repository text.
 * The full scan and `check:quick` use the same set: root files plus
 * packages, apps, scripts, and docs, skipping generated trees and binaries.
 * Pass repo-relative paths to scan only those files.
 *
 * Usage:
 *   bun run scripts/quality/check-conflict-markers.mjs
 *   bun run scripts/quality/check-conflict-markers.mjs --staged
 *   bun run scripts/quality/check-conflict-markers.mjs packages/ai/src/index.ts
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
	CheckViolation,
	collectFileViolations,
	isBinaryLike,
	isDirectRun,
	readText,
	repoRoot,
	runCheck,
	stagedFiles,
	toPosix,
	walkFiles,
} from "./lib.mjs";

const SCAN_ROOTS = ["packages", "apps", "scripts", "docs"];
const SKIP_PARTS = [
	"/node_modules/",
	"/dist/",
	"/.git/",
	"/.next/",
	"/coverage/",
	"/out/",
	"/build/",
	"/.turbo/",
	"/.cache/",
	"/release/",
	"/releases/",
];

/** Non-binary text outside generated trees. `check:quick` and the full guard both use this list. */
export function selectConflictMarkerFiles(files) {
	return files.filter((file) => {
		if (isBinaryLike(file)) return false;
		const path = `/${toPosix(file)}`;
		return SKIP_PARTS.every((part) => !path.includes(part));
	});
}

function repoRelative(root, file) {
	return toPosix(relative(root, file));
}

/** Full-tree paths. Pass `root` only from tests; the guard itself uses the process cwd. */
export function listConflictMarkerTargets(root = repoRoot) {
	const files = [];
	for (const dir of SCAN_ROOTS) {
		files.push(...walkFiles(join(root, dir), { extensions: null }).map((file) => repoRelative(root, file)));
	}
	let entries = [];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		entries = [];
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		files.push(entry.name);
	}
	return selectConflictMarkerFiles(files);
}

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

function collectTargets({ stagedOnly = false, files = [] } = {}) {
	if (stagedOnly) {
		return selectConflictMarkerFiles(stagedFiles()).filter((file) => existsSync(join(repoRoot, file)));
	}
	if (files.length > 0) {
		return selectConflictMarkerFiles(files).filter((file) => existsSync(join(repoRoot, file)));
	}
	return listConflictMarkerTargets();
}

/** Read each repo-relative path and return marker violations. A file that cannot be read is skipped. */
export function checkConflictMarkers(files, readFile = (file) => readText(join(repoRoot, file))) {
	return collectFileViolations(files, findConflictMarkerViolationsInText, readFile);
}

export function main(args = process.argv.slice(2)) {
	const stagedOnly = args.includes("--staged");
	const files = args.filter((arg) => arg !== "--staged");
	return runCheck("conflict-markers", () => checkConflictMarkers(collectTargets({ stagedOnly, files })));
}

if (isDirectRun(import.meta.url)) {
	process.exitCode = main();
}
