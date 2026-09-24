/**
 * Monorepo package boundaries.
 *
 * Rules live in scripts/quality/rules/package-boundaries.yml.
 * The deprecated checker in check-package-boundaries.legacy.mjs is the
 * behavior baseline for the differential test.
 *
 * Usage:
 *   bun run scripts/quality/check-package-boundaries.mjs
 */

import { join } from "node:path";
import { evaluateBoundaryFile, evaluateBoundaryManifest, loadBoundaryDocument } from "./arch-engine/boundary-rules.mjs";
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

function scanRoot(root, manifest, spec, findings) {
	let scanned = 0;
	for (const file of walkFiles(join(repoRoot, root))) {
		const posixPath = rel(file);
		if (spec.scan.skipContains.some((part) => posixPath.includes(part))) continue;
		let text;
		try {
			text = readText(file);
		} catch {
			continue;
		}
		scanned += 1;
		findings.push(...evaluateBoundaryFile(spec, posixPath, text, { manifest }));
	}
	return scanned;
}

function scanBoundaries() {
	const spec = rules();
	const findings = [];
	let scanned = 0;
	for (const entry of spec.scan.entryPaths) {
		findings.push(...evaluateBoundaryFile(spec, entry, readText(join(repoRoot, entry))));
		scanned += 1;
	}
	for (const root of spec.scan.roots) {
		let manifest;
		try {
			manifest = JSON.parse(readText(join(repoRoot, root, "package.json")));
		} catch {
			manifest = undefined;
		}
		for (const finding of evaluateBoundaryManifest(spec, manifest)) findings.push(manifestRecord(finding));
		scanned += scanRoot(root, manifest, spec, findings);
	}
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

export function main() {
	try {
		return scanBoundaries();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(`[package-boundaries] internal error: ${message}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
