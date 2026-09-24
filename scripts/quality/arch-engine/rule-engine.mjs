/**
 * Declarative architecture rules loaded from YAML.
 *
 * `sources` match the repo-relative file path. `targets` match the module
 * specifier text, not a resolved file. A trailing `**` matches zero or more
 * segments, so `@vetta/desktop/**` includes `@vetta/desktop`. A pattern whose
 * first character is `!` removes a match; a later pattern can match again.
 * Type-only imports and `import("mod")` in type position still count, as do
 * no-substitution template literals. A template with `${}` does not. An
 * identifier callee named `require` counts even when that name is local.
 *
 * Quote a pattern that starts with `*`, `!`, `@`, or `&`. An unquoted `!` is a
 * YAML tag and would otherwise become an empty pattern.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { CheckViolation, toPosix } from "../lib.mjs";
import { parseSource, walkAst } from "./ast-walker.mjs";

const DOCUMENT_FIELDS = new Set(["name", "description", "rationale", "examples", "rules"]);
const EXAMPLE_FIELDS = new Set(["violation", "fix"]);
const RULE_FIELDS = new Set(["name", "type", "sources", "targets", "message"]);

export class RuleDocumentError extends Error {
	constructor(source, message, options) {
		super(`${source}: ${message}`, options);
		this.name = "RuleDocumentError";
	}
}

function fail(source, message) {
	throw new RuleDocumentError(source, message);
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownField(value, allowed) {
	return Object.keys(value).find((key) => !allowed.has(key));
}

function requiredText(value, source, label) {
	if (typeof value !== "string" || value.trim() === "") fail(source, `${label} must be a non-empty string`);
	return value.trim();
}

function readPattern(pattern, source, label) {
	if (typeof pattern !== "string") fail(source, `${label} must be a string`);
	const negated = pattern.startsWith("!");
	const body = toPosix(negated ? pattern.slice(1) : pattern);
	if (body.length === 0) fail(source, `${label} is an invalid glob pattern`);
	return { negated, body };
}

function patternList(value, source, label) {
	if (!Array.isArray(value) || value.length === 0) {
		fail(source, `${label} must be a non-empty list of glob patterns`);
	}
	return value.map((pattern, index) => {
		readPattern(pattern, source, `${label}[${index}]`);
		return pattern;
	});
}

function matchSegmentAt(text, pattern, textIndex, patternIndex) {
	if (patternIndex === pattern.length) return textIndex === text.length;
	if (pattern[patternIndex] === "*") {
		for (let skip = 0; skip <= text.length - textIndex; skip += 1) {
			if (matchSegmentAt(text, pattern, textIndex + skip, patternIndex + 1)) return true;
		}
		return false;
	}
	if (textIndex >= text.length) return false;
	if (pattern[patternIndex] !== "?" && pattern[patternIndex] !== text[textIndex]) return false;
	return matchSegmentAt(text, pattern, textIndex + 1, patternIndex + 1);
}

function matchSegments(pathSegments, patternSegments, pathIndex, patternIndex) {
	while (patternIndex < patternSegments.length) {
		const pattern = patternSegments[patternIndex];
		if (pattern === "**") {
			if (patternIndex === patternSegments.length - 1) return true;
			for (let skip = pathIndex; skip <= pathSegments.length; skip += 1) {
				if (matchSegments(pathSegments, patternSegments, skip, patternIndex + 1)) return true;
			}
			return false;
		}
		if (pathIndex >= pathSegments.length || !matchSegmentAt(pathSegments[pathIndex], pattern, 0, 0)) return false;
		pathIndex += 1;
		patternIndex += 1;
	}
	return pathIndex === pathSegments.length;
}

function matchGlob(path, pattern) {
	const pathSegments = path === "" ? [] : path.split("/");
	return matchSegments(pathSegments, pattern.split("/"), 0, 0);
}

/** Return true when `value` matches `patterns`. Negated patterns apply in order. */
export function matchesGlobs(value, patterns) {
	if (typeof value !== "string") fail("<glob>", "glob value must be a string");
	if (!Array.isArray(patterns)) fail("<glob>", "glob patterns must be an array");
	const path = toPosix(value);
	let matched = false;
	for (let index = 0; index < patterns.length; index += 1) {
		const pattern = readPattern(patterns[index], "<glob>", `patterns[${index}]`);
		if (!matchGlob(path, pattern.body)) continue;
		matched = !pattern.negated;
	}
	return matched;
}

function unwrapParens(node) {
	let current = node;
	while (current?.kind === "ParenthesizedExpression") current = current.children?.[0];
	return current;
}

function moduleLiteral(node) {
	const current = unwrapParens(node);
	if (
		(current?.kind === "StringLiteral" || current?.kind === "NoSubstitutionTemplateLiteral") &&
		typeof current.text === "string"
	) {
		return { text: current.text, line: current.line };
	}
	return null;
}

function firstModuleLiteral(nodes) {
	if (!nodes) return null;
	for (const node of nodes) {
		const literal = moduleLiteral(node);
		if (literal) return literal;
	}
	return null;
}

function moduleSpecifier(node) {
	if (node.kind === "ImportDeclaration" || node.kind === "ExportDeclaration") {
		return firstModuleLiteral(node.children);
	}
	if (node.kind === "ImportEqualsDeclaration") {
		const reference = node.children?.find((child) => child.kind === "ExternalModuleReference");
		return firstModuleLiteral(reference?.children);
	}
	if (node.kind === "ImportType") {
		const literalType = node.children?.find((child) => child.kind === "LiteralType");
		return firstModuleLiteral(node.children) ?? firstModuleLiteral(literalType?.children);
	}
	if (node.kind !== "CallExpression") return null;
	const callee = unwrapParens(node.children?.[0]);
	const dynamicImport = callee?.kind === "ImportKeyword";
	const required = callee?.kind === "Identifier" && callee.text === "require";
	if (!dynamicImport && !required) return null;
	return firstModuleLiteral(node.children?.slice(1));
}

function collectModuleSpecifiers(ast) {
	const specifiers = [];
	walkAst(ast, (node) => {
		const specifier = moduleSpecifier(node);
		if (specifier) specifiers.push(specifier);
	});
	return specifiers;
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

function validateRule(rule, source, index = 0) {
	const label = `rules[${index}]`;
	if (!isPlainObject(rule)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(rule, RULE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	if (rule.type !== "forbidden-import") fail(source, `${label}.type must be "forbidden-import"`);
	return {
		name: requiredText(rule.name, source, `${label}.name`),
		type: rule.type,
		sources: patternList(rule.sources, source, `${label}.sources`),
		targets: patternList(rule.targets, source, `${label}.targets`),
		message: requiredText(rule.message, source, `${label}.message`),
	};
}

function validateDocument(value, source) {
	if (!isPlainObject(value)) fail(source, "rule document must be a mapping");
	const unknown = unknownField(value, DOCUMENT_FIELDS);
	if (unknown) fail(source, `unknown field "${unknown}"`);
	const name = requiredText(value.name, source, "name");
	const description = requiredText(value.description, source, "description");
	const rationale = requiredText(value.rationale, source, "rationale");
	if (!Array.isArray(value.examples)) fail(source, "examples must be a list");
	if (!Array.isArray(value.rules) || value.rules.length === 0) fail(source, "rules must be a non-empty list");
	const seen = new Set();
	const rules = value.rules.map((rule, index) => {
		const validated = validateRule(rule, source, index);
		if (seen.has(validated.name)) fail(source, `rules[${index}].name duplicates ${validated.name}`);
		seen.add(validated.name);
		return validated;
	});
	return {
		name,
		description,
		rationale,
		examples: value.examples.map((example, index) => validateExample(example, source, index)),
		rules,
	};
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

function parseYaml(text, source) {
	if (typeof text !== "string") fail(source, "rule document must be a string");
	const document = parseDocument(text);
	const problem = document.errors[0] ?? document.warnings[0];
	if (problem) fail(source, problem.message);
	try {
		return document.toJS();
	} catch (error) {
		throw new RuleDocumentError(source, errorText(error));
	}
}

/** Parse and validate one rule document. `sourceName` is included in errors. */
export function parseRuleDocument(text, sourceName = "<inline>") {
	return validateDocument(parseYaml(text, sourceName), sourceName);
}

function errorCode(error) {
	return error && typeof error === "object" && "code" in error ? error.code : "unknown";
}

/** Read one YAML rule file. */
export function loadRuleDocument(filePath) {
	let text;
	try {
		text = readFileSync(filePath, "utf8");
	} catch (error) {
		throw new RuleDocumentError(filePath, `unable to read rule file (${errorCode(error)})`);
	}
	return parseRuleDocument(text, filePath);
}

/** Read every `.yml` and `.yaml` file in a directory, sorted by file name. */
export function loadRuleDirectory(directory) {
	let names;
	try {
		names = readdirSync(directory);
	} catch (error) {
		throw new RuleDocumentError(directory, `unable to read rule directory (${errorCode(error)})`);
	}
	return names
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.sort()
		.map((name) => loadRuleDocument(join(directory, name)));
}

/**
 * Run one forbidden-import rule.
 * `files` are `{ path, text }`. The path is repo-relative.
 */
export function checkRule(rule, files) {
	const checked = validateRule(rule, "<rule>");
	if (!Array.isArray(files)) fail("<rule>", "files must be an array");
	const violations = [];
	for (const file of files) {
		if (!file || typeof file.path !== "string" || typeof file.text !== "string") {
			fail("<rule>", "each file needs a path and text");
		}
		const path = toPosix(file.path);
		if (!matchesGlobs(path, checked.sources)) continue;
		const ast = parseSource(path, file.text);
		for (const specifier of collectModuleSpecifiers(ast)) {
			if (!matchesGlobs(specifier.text, checked.targets)) continue;
			violations.push(new CheckViolation(path, specifier.line, checked.name, checked.message));
		}
	}
	return violations;
}

/** Run every rule in a parsed document. Rules run in document order, then files in input order. */
export function checkDocument(document, files) {
	if (!isPlainObject(document) || !Array.isArray(document.rules)) fail("<document>", "rules must be a list");
	const violations = [];
	for (const rule of document.rules) violations.push(...checkRule(rule, files));
	return violations;
}
