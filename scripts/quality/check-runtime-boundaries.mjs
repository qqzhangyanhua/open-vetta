/**
 * Runtime package boundaries.
 *
 * Rules live in scripts/quality/rules/runtime-boundaries.yml.
 * One run covers Coding Agent independence, the subagent kernel, and the
 * production failure contract. The sentences on failure stay the ones those
 * guards printed.
 *
 * Usage:
 *   bun run scripts/quality/check-runtime-boundaries.mjs
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateRuntimeGuard, formatRuntimeSummary, loadRuntimeDocument } from "./arch-engine/runtime-rules.mjs";
import { fail, isDirectRun, ok, readText, rel, repoRoot, toPosix, walkFiles } from "./lib.mjs";

const documentPath = join(repoRoot, "scripts/quality/rules/runtime-boundaries.yml");
let document;

function rules() {
	if (!document) document = loadRuntimeDocument(documentPath);
	return document;
}

function guardNamed(name) {
	const guard = rules().guards.find((item) => item.name === name);
	if (!guard) throw new Error(`runtime guard ${name} is missing`);
	return guard;
}

function readManifest(packageDir) {
	const manifestPath = join(repoRoot, packageDir, "package.json");
	return { path: rel(manifestPath), content: JSON.parse(readText(manifestPath)) };
}

export function collectRuntimeCodingAgentIndependenceInput(guard = guardNamed("coding-agent-independence")) {
	const manifests = [];
	const files = [];
	for (const packageDir of guard.scan.packages) {
		const manifestPath = join(repoRoot, packageDir, "package.json");
		if (existsSync(manifestPath)) manifests.push(readManifest(packageDir));
		for (const filePath of walkFiles(join(repoRoot, packageDir))) {
			files.push({ path: rel(filePath), text: readText(filePath) });
		}
	}
	return { manifests, files };
}

export function collectRuntimeSubagentsBoundaryInput(guard = guardNamed("subagents-boundary")) {
	const packageDir = guard.scan.package;
	const sourceDir = join(repoRoot, packageDir, guard.scan.directory);
	return {
		manifest: readManifest(packageDir),
		files: walkFiles(sourceDir, { extensions: guard.scan.extensions }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	};
}

export function collectRuntimeFailureContractInput(guard = guardNamed("failure-contract")) {
	const files = guard.scan.roots.flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: guard.scan.extensions })
			.filter((filePath) => guard.scan.excludeSuffixes.every((suffix) => !filePath.endsWith(suffix)))
			.map((filePath) => ({ path: toPosix(filePath.slice(repoRoot.length + 1)), text: readText(filePath) })),
	);
	for (const path of guard.scan.files) files.push({ path, text: readText(join(repoRoot, path)) });
	return files;
}

export function findRuntimeCodingAgentIndependenceViolations(input) {
	return evaluateRuntimeGuard(guardNamed("coding-agent-independence"), input);
}

export function findRuntimeSubagentsBoundaryViolations(input) {
	return evaluateRuntimeGuard(guardNamed("subagents-boundary"), input);
}

export function findRuntimeFailureContractViolations(files, options) {
	return evaluateRuntimeGuard(guardNamed("failure-contract"), files, options);
}

function markerTable(guard) {
	return Object.freeze(
		Object.fromEntries(guard.markers.files.map((file) => [file.path, Object.freeze([...file.tokens])])),
	);
}

export const REQUIRED_RUNTIME_FAILURE_MARKERS = markerTable(guardNamed("failure-contract"));

function collect(guard) {
	if (guard.input === "manifests") return collectRuntimeCodingAgentIndependenceInput(guard);
	if (guard.input === "manifest") return collectRuntimeSubagentsBoundaryInput(guard);
	return collectRuntimeFailureContractInput(guard);
}

export function main() {
	try {
		let code = 0;
		for (const guard of rules().guards) {
			const input = collect(guard);
			const violations = evaluateRuntimeGuard(guard, input);
			if (violations.length > 0) {
				for (const violation of violations) fail(`[${guard.label}] ${violation}`);
				code = 1;
				continue;
			}
			ok(`[${guard.label}] ok (${formatRuntimeSummary(guard, input)})`);
		}
		return code;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(`[runtime-boundaries] internal error: ${message}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
