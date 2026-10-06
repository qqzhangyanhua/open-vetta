/**
 * Runtime boundary rules loaded from YAML.
 *
 * The checker prints the same sentences as the three guards this document
 * replaced. A new ban, marker, or required file is a new entry here, not a
 * new function. `{section}`, `{dependency}`, `{token}`, and `{marker}` in a
 * report are replaced with the value that matched.
 */

import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { toPosix } from "../lib.mjs";

const DOCUMENT_FIELDS = new Set(["name", "description", "rationale", "examples", "guards"]);
const EXAMPLE_FIELDS = new Set(["violation", "fix"]);
const GUARD_FIELDS = new Set([
	"name",
	"label",
	"summary",
	"input",
	"scan",
	"manifests",
	"lines",
	"requiredFiles",
	"retiredFiles",
	"markers",
	"patterns",
]);
const INPUT_SCAN_KIND = {
	manifests: "packages",
	manifest: "package-source",
	files: "boundary",
};
const SCAN_FIELDS = {
	packages: new Set(["kind", "packages"]),
	"package-source": new Set(["kind", "package", "directory", "extensions"]),
	boundary: new Set(["kind", "roots", "extensions", "excludeSuffixes", "files"]),
};
const MANIFEST_FIELDS = new Set(["sections", "key", "keyPrefix", "report"]);
const LINE_FIELDS = new Set(["path", "whenPathIncludes", "tokens", "report"]);
const PATH_LIST_FIELDS = new Set(["report", "paths"]);
const MARKER_FIELDS = new Set(["missingFile", "missingMarker", "files"]);
const MARKER_FILE_FIELDS = new Set(["path", "tokens"]);
const PATTERN_FIELDS = new Set(["label", "source", "flags"]);
const FLAG_CHARS = new Set(["i", "m", "s", "u"]);

export class RuntimeDocumentError extends Error {
	constructor(source, message) {
		super(`${source}: ${message}`);
		this.name = "RuntimeDocumentError";
	}
}

function fail(source, message) {
	throw new RuntimeDocumentError(source, message);
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownField(value, allowed) {
	return Object.keys(value).find((key) => !allowed.has(key));
}

function requiredText(value, source, label) {
	if (typeof value !== "string" || value.trim() === "") fail(source, `${label} must be a non-empty string`);
	return value;
}

function optionalText(value, source, label) {
	if (value === undefined) return undefined;
	return requiredText(value, source, label);
}

function asList(value, source, label) {
	if (!Array.isArray(value) || value.length === 0) fail(source, `${label} must be a non-empty list`);
	return value;
}

function stringList(value, source, label) {
	return asList(value, source, label).map((item, index) => requiredText(item, source, `${label}[${index}]`));
}

function fill(template, values) {
	let text = template;
	for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{${key}}`, value);
	return text;
}

function validateExample(example, source, index) {
	const label = `examples[${index}]`;
	if (!isPlainObject(example)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(example, EXAMPLE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	return {
		violation: requiredText(example.violation, source, `${label}.violation`),
		fix: requiredText(example.fix, source, `${label}.fix`),
	};
}

function validateScan(scan, input, source, label) {
	if (!isPlainObject(scan)) fail(source, `${label} must be a mapping`);
	const kind = requiredText(scan.kind, source, `${label}.kind`);
	if (kind !== INPUT_SCAN_KIND[input]) fail(source, `${label}.kind must be "${INPUT_SCAN_KIND[input]}"`);
	const unknown = unknownField(scan, SCAN_FIELDS[kind]);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	if (kind === "packages") return { kind, packages: stringList(scan.packages, source, `${label}.packages`) };
	if (kind === "package-source") {
		return {
			kind,
			package: requiredText(scan.package, source, `${label}.package`),
			directory: requiredText(scan.directory, source, `${label}.directory`),
			extensions: stringList(scan.extensions, source, `${label}.extensions`),
		};
	}
	return {
		kind,
		roots: stringList(scan.roots, source, `${label}.roots`),
		extensions: stringList(scan.extensions, source, `${label}.extensions`),
		excludeSuffixes: stringList(scan.excludeSuffixes, source, `${label}.excludeSuffixes`),
		files: stringList(scan.files, source, `${label}.files`),
	};
}

function validateManifests(value, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(value, MANIFEST_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const key = optionalText(value.key, source, `${label}.key`);
	const keyPrefix = optionalText(value.keyPrefix, source, `${label}.keyPrefix`);
	if (Boolean(key) === Boolean(keyPrefix)) fail(source, `${label} must set exactly one of key or keyPrefix`);
	return {
		sections: stringList(value.sections, source, `${label}.sections`),
		key,
		keyPrefix,
		report: requiredText(value.report, source, `${label}.report`),
	};
}

function validateLines(value, source, label) {
	if (value === undefined) return [];
	return asList(value, source, label).map((rule, index) => {
		const item = `${label}[${index}]`;
		if (!isPlainObject(rule)) fail(source, `${item} must be a mapping`);
		const unknown = unknownField(rule, LINE_FIELDS);
		if (unknown) fail(source, `${item} has unknown field "${unknown}"`);
		return {
			path: optionalText(rule.path, source, `${item}.path`),
			whenPathIncludes: optionalText(rule.whenPathIncludes, source, `${item}.whenPathIncludes`),
			tokens: stringList(rule.tokens, source, `${item}.tokens`),
			report: requiredText(rule.report, source, `${item}.report`),
		};
	});
}

function validatePathList(value, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(value, PATH_LIST_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	return {
		report: requiredText(value.report, source, `${label}.report`),
		paths: stringList(value.paths, source, `${label}.paths`),
	};
}

function validateMarkers(value, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(value, MARKER_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const files = asList(value.files, source, `${label}.files`).map((file, index) => {
		const item = `${label}.files[${index}]`;
		if (!isPlainObject(file)) fail(source, `${item} must be a mapping`);
		const extra = unknownField(file, MARKER_FILE_FIELDS);
		if (extra) fail(source, `${item} has unknown field "${extra}"`);
		return {
			path: requiredText(file.path, source, `${item}.path`),
			tokens: stringList(file.tokens, source, `${item}.tokens`),
		};
	});
	return {
		missingFile: requiredText(value.missingFile, source, `${label}.missingFile`),
		missingMarker: requiredText(value.missingMarker, source, `${label}.missingMarker`),
		files,
	};
}

function validatePatterns(value, source, label) {
	if (value === undefined) return [];
	return asList(value, source, label).map((pattern, index) => {
		const item = `${label}[${index}]`;
		if (!isPlainObject(pattern)) fail(source, `${item} must be a mapping`);
		const unknown = unknownField(pattern, PATTERN_FIELDS);
		if (unknown) fail(source, `${item} has unknown field "${unknown}"`);
		const flags = pattern.flags === undefined ? "" : requiredText(pattern.flags, source, `${item}.flags`);
		for (const char of flags) {
			if (!FLAG_CHARS.has(char)) fail(source, `${item}.flags must contain only i, m, s, or u`);
		}
		const expression = requiredText(pattern.source, source, `${item}.source`);
		let regex;
		try {
			regex = new RegExp(expression, flags);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			fail(source, `${item}.source is not a valid regular expression (${message})`);
		}
		return { label: requiredText(pattern.label, source, `${item}.label`), regex };
	});
}

function validateGuard(guard, source, index) {
	const label = `guards[${index}]`;
	if (!isPlainObject(guard)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(guard, GUARD_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const input = requiredText(guard.input, source, `${label}.input`);
	if (!Object.hasOwn(INPUT_SCAN_KIND, input)) fail(source, `${label}.input must be manifests, manifest, or files`);
	const compiled = {
		name: requiredText(guard.name, source, `${label}.name`),
		label: requiredText(guard.label, source, `${label}.label`),
		summary: requiredText(guard.summary, source, `${label}.summary`),
		input,
		scan: validateScan(guard.scan, input, source, `${label}.scan`),
		manifests: validateManifests(guard.manifests, source, `${label}.manifests`),
		lines: validateLines(guard.lines, source, `${label}.lines`),
		requiredFiles: validatePathList(guard.requiredFiles, source, `${label}.requiredFiles`),
		retiredFiles: validatePathList(guard.retiredFiles, source, `${label}.retiredFiles`),
		markers: validateMarkers(guard.markers, source, `${label}.markers`),
		patterns: validatePatterns(guard.patterns, source, `${label}.patterns`),
	};
	const hasFileRule = compiled.markers || compiled.patterns.length > 0;
	const hasPackageRule =
		compiled.manifests || compiled.lines.length > 0 || compiled.requiredFiles || compiled.retiredFiles;
	if (input === "files" && hasPackageRule) fail(source, `${label} cannot declare package rules`);
	if (input !== "files" && hasFileRule) fail(source, `${label} cannot declare markers or patterns`);
	if (input === "files" && !hasFileRule) fail(source, `${label} must declare markers or patterns`);
	if (input !== "files" && !hasPackageRule) fail(source, `${label} must declare manifests, lines, or owner files`);
	return compiled;
}

function validateDocument(value, source) {
	if (!isPlainObject(value)) fail(source, "rule document must be a mapping");
	const unknown = unknownField(value, DOCUMENT_FIELDS);
	if (unknown) fail(source, `unknown field "${unknown}"`);
	if (!Array.isArray(value.examples)) fail(source, "examples must be a list");
	const guards = asList(value.guards, source, "guards").map((guard, index) => validateGuard(guard, source, index));
	const names = new Set();
	const labels = new Set();
	for (const [index, guard] of guards.entries()) {
		if (names.has(guard.name)) fail(source, `guards[${index}].name duplicates ${guard.name}`);
		if (labels.has(guard.label)) fail(source, `guards[${index}].label duplicates ${guard.label}`);
		names.add(guard.name);
		labels.add(guard.label);
	}
	return {
		name: requiredText(value.name, source, "name"),
		description: requiredText(value.description, source, "description"),
		rationale: requiredText(value.rationale, source, "rationale"),
		examples: value.examples.map((example, index) => validateExample(example, source, index)),
		guards,
	};
}

function parseYaml(text, source) {
	if (typeof text !== "string") fail(source, "rule document must be a string");
	const document = parseDocument(text);
	const problem = document.errors[0] ?? document.warnings[0];
	if (problem) fail(source, problem.message);
	try {
		return document.toJS();
	} catch (error) {
		fail(source, error instanceof Error ? error.message : String(error));
	}
	return {};
}

/** Parse one runtime boundary document. `sourceName` is included in errors. */
export function parseRuntimeDocument(text, sourceName = "<inline>") {
	return validateDocument(parseYaml(text, sourceName), sourceName);
}

/** Read and compile a runtime boundary YAML file. */
export function loadRuntimeDocument(filePath) {
	let text;
	try {
		text = readFileSync(filePath, "utf8");
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
		throw new RuntimeDocumentError(filePath, `unable to read rule file (${code})`);
	}
	return parseRuntimeDocument(text, filePath);
}

function dependencyViolations(manifest, spec) {
	if (!spec) return [];
	const violations = [];
	for (const section of spec.sections) {
		const record = manifest.content[section] ?? {};
		if (spec.key) {
			if (record[spec.key] === undefined) continue;
			violations.push(`${manifest.path}: ${fill(spec.report, { section, dependency: spec.key })}`);
			continue;
		}
		for (const dependency of Object.keys(record)) {
			if (!dependency.startsWith(spec.keyPrefix)) continue;
			violations.push(`${manifest.path}: ${fill(spec.report, { section, dependency })}`);
		}
	}
	return violations;
}

function lineViolations(file, rules) {
	const violations = [];
	const normalized = toPosix(file.path);
	const lines = file.text.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		for (const rule of rules) {
			if (rule.path && normalized !== rule.path) continue;
			if (rule.whenPathIncludes && !normalized.includes(rule.whenPathIncludes)) continue;
			for (const token of rule.tokens) {
				if (!line.includes(token)) continue;
				violations.push(`${file.path}:${index + 1}: ${fill(rule.report, { token })}`);
			}
		}
	}
	return violations;
}

function presenceViolations(files, guard) {
	const violations = [];
	const paths = new Set(files.map((file) => toPosix(file.path)));
	if (guard.requiredFiles) {
		for (const required of guard.requiredFiles.paths) {
			if (!paths.has(required)) violations.push(`${required}: ${guard.requiredFiles.report}`);
		}
	}
	if (guard.retiredFiles) {
		for (const retired of guard.retiredFiles.paths) {
			if (paths.has(retired)) violations.push(`${retired}: ${guard.retiredFiles.report}`);
		}
	}
	return violations;
}

function packageViolations(guard, manifests, files) {
	const violations = [];
	for (const manifest of manifests) violations.push(...dependencyViolations(manifest, guard.manifests));
	for (const file of files) violations.push(...lineViolations(file, guard.lines));
	violations.push(...presenceViolations(files, guard));
	return violations;
}

function markerViolations(markers, files) {
	const violations = [];
	const filesByPath = new Map(files.map((file) => [toPosix(file.path), file.text]));
	for (const required of markers.files) {
		const text = filesByPath.get(required.path);
		if (text === undefined) {
			violations.push(`${required.path}: ${markers.missingFile}`);
			continue;
		}
		for (const marker of required.tokens) {
			if (!text.includes(marker)) violations.push(`${required.path}: ${fill(markers.missingMarker, { marker })}`);
		}
	}
	return violations;
}

function patternViolations(patterns, file) {
	const violations = [];
	for (const pattern of patterns) {
		if (!pattern.regex.test(file.text)) continue;
		violations.push(`${toPosix(file.path)}: ${pattern.label}`);
	}
	return violations;
}

/**
 * Run one compiled guard.
 * `manifests` input is `{ manifests, files }`. `manifest` input is `{ manifest, files }`.
 * `files` input is the file array. `requireBaseline: false` skips required markers.
 */
export function evaluateRuntimeGuard(guard, input, options = {}) {
	if (!guard || typeof guard.input !== "string") fail("<guard>", "guard is not compiled");
	if (guard.input === "files") {
		if (!Array.isArray(input)) fail("<guard>", "files must be an array");
		const violations = [];
		if (options.requireBaseline !== false && guard.markers)
			violations.push(...markerViolations(guard.markers, input));
		for (const file of input) violations.push(...patternViolations(guard.patterns, file));
		return violations;
	}
	if (!input || !Array.isArray(input.files)) fail("<guard>", "files must be an array");
	const manifests = guard.input === "manifests" ? input.manifests : [input.manifest];
	if (!Array.isArray(manifests)) fail("<guard>", "manifests must be an array");
	return packageViolations(guard, manifests, input.files);
}

/** Counts interpolated into a guard's ok line. */
export function formatRuntimeSummary(guard, input) {
	const manifests = guard.input === "manifests" ? input.manifests.length : 0;
	const files = guard.input === "files" ? input.length : input.files.length;
	return fill(guard.summary, { manifests: String(manifests), files: String(files) });
}
