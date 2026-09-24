/**
 * Coding Agent dependency direction and public boundaries.
 *
 * Rules live in scripts/quality/rules/coding-agent-architecture.yml.
 * The deprecated checker in check-coding-agent-architecture.legacy.mjs is the
 * behavior baseline for the differential test.
 *
 * Usage:
 *   bun run scripts/quality/check-coding-agent-architecture.mjs
 */

import { join } from "node:path";
import {
	collectCodingAgentArchitectureState as collectState,
	evaluateCodingAgentArchitecture,
	loadCodingAgentDocument,
} from "./arch-engine/coding-agent-rules.mjs";
import { CheckViolation, fail, isDirectRun, ok, readText, rel, repoRoot, toPosix, walkFiles } from "./lib.mjs";

const documentPath = join(repoRoot, "scripts/quality/rules/coding-agent-architecture.yml");
let document;

function rules() {
	if (!document) document = loadCodingAgentDocument(documentPath);
	return document;
}

export function collectCodingAgentArchitectureState(input) {
	return collectState(input, rules().package.sourceRoot);
}

export function findCodingAgentArchitectureViolations(state) {
	return evaluateCodingAgentArchitecture(rules(), state).map((finding) => finding.text);
}

/** Failure lines for a direct run. The legacy strings stay on `finding.text`. */
export function formatCodingAgentArchitectureFailures(findings, spec) {
	const lines = findings.map((finding) =>
		new CheckViolation(finding.file, finding.line, finding.rule, finding.message).format("coding-agent-architecture"),
	);
	const cited = [...spec.docs];
	for (const finding of findings) {
		if (finding.doc && !cited.includes(finding.doc)) cited.push(finding.doc);
	}
	if (cited.length > 0) lines.push(`[coding-agent-architecture] see: ${cited.join("; ")}`);
	lines.push(`[coding-agent-architecture] ${findings.length} violation(s)`);
	return lines;
}

export function readCodingAgentArchitectureInput(spec = rules()) {
	const scan = spec.scan;
	const codingAgentFiles = walkFiles(join(repoRoot, scan.sourceRoot), { extensions: scan.sourceExtensions }).map(
		(path) => ({
			path: rel(path),
			text: readText(path),
		}),
	);
	const consumerFiles = scan.consumerRoots
		.flatMap((workspaceRoot) => walkFiles(join(repoRoot, workspaceRoot), { extensions: scan.consumerExtensions }))
		.filter((path) => {
			const normalized = toPosix(path);
			return scan.skipContains.every((part) => !normalized.includes(part));
		})
		.map((path) => ({ path: rel(path), text: readText(path) }))
		.filter(
			(file) =>
				!file.path.startsWith(`${spec.package.root}/`) &&
				(scan.consumerTextIncludes.some((part) => file.text.includes(part)) ||
					scan.consumerPaths.includes(file.path) ||
					scan.consumerPrefixes.some((prefix) => file.path.startsWith(prefix))),
		);
	return {
		files: [...codingAgentFiles, ...consumerFiles],
		packageJson: JSON.parse(readText(join(repoRoot, spec.package.manifest))),
	};
}

export function main() {
	try {
		const spec = rules();
		const state = collectCodingAgentArchitectureState(readCodingAgentArchitectureInput(spec));
		const findings = evaluateCodingAgentArchitecture(spec, state);
		if (findings.length === 0) {
			ok(
				`[coding-agent-architecture] ok (source files=${state.sourcePaths.length}, module edges=${state.edges.length}, manifest exports=${state.packageExports.length})`,
			);
			return 0;
		}
		for (const line of formatCodingAgentArchitectureFailures(findings, spec)) fail(line);
		return 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(`[coding-agent-architecture] internal error: ${message}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
