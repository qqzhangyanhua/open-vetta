/**
 * Coding Agent architecture rules loaded from YAML.
 *
 * File selection and the violation strings stay in the document. This module
 * walks import / export / dynamic import edges the same way as the legacy
 * checker, then runs the document's steps in order. A new constraint is a
 * new step, not a new function in the checker.
 */

import { readFileSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";
import { parseDocument } from "yaml";
import { toPosix } from "../lib.mjs";

const DOCUMENT_FIELDS = new Set([
	"name",
	"description",
	"rationale",
	"examples",
	"docs",
	"package",
	"classes",
	"compositionPublic",
	"lists",
	"groups",
	"scan",
	"rules",
]);
const EXAMPLE_FIELDS = new Set(["violation", "fix"]);
const PACKAGE_FIELDS = new Set(["root", "sourceRoot", "specifier", "manifest"]);
const COMPOSITION_FIELDS = new Set(["sameDirectory", "prefixes", "externalSpecifiers"]);
const SCAN_FIELDS = new Set([
	"sourceRoot",
	"sourceExtensions",
	"consumerRoots",
	"consumerExtensions",
	"skipContains",
	"consumerTextIncludes",
	"consumerPaths",
	"consumerPrefixes",
]);
const CLASS_FIELDS = new Set(["any", "all", "anyClass"]);
const CLAUSE_FIELDS = new Set(["prefix", "exact", "suffix", "class", "not", "anyPrefix"]);
const WHEN_FIELDS = new Set([
	"pathPrefix",
	"pathPrefixFrom",
	"pathExact",
	"pathExactFrom",
	"pathSuffix",
	"pathNotPrefix",
	"pathNotPrefixFrom",
	"pathNotExact",
	"pathNotExactFrom",
	"pathClass",
	"pathNotClass",
	"textIncludes",
	"textRegex",
	"textRegexAny",
	"flags",
	"specifierPrefix",
	"specifierPrefixFrom",
	"specifierExact",
	"specifierNot",
	"kind",
	"kindNot",
	"namesIncludes",
	"outsidePackage",
	"specifierPackagePrefix",
	"unpublished",
	"targetExact",
	"targetNotExact",
	"targetPrefix",
	"targetClass",
	"targetClassAny",
	"notCompositionPublic",
]);
const STEP_FIELDS = {
	eachFile: ["steps"],
	eachEdge: ["steps"],
	eachSourcePath: ["steps"],
	eachExport: ["steps"],
	eachItem: ["steps", "items", "itemsFrom", "skipIfAbsent"],
	eachText: ["includes", "includesFrom", "report"],
	ifSourceHas: ["paths", "pathsFrom", "report"],
	ifExport: ["names", "namesFrom", "report"],
	file: ["path", "steps"],
	when: ["steps", "report"],
	whenAny: ["steps", "report", "checks"],
	whenTargetInside: ["steps"],
	unlessAll: ["checks", "report"],
	unlessAny: ["checks", "report"],
	unlessText: ["regex", "flags", "report"],
	unlessImport: ["specifier", "name", "report"],
	retiredTerm: ["term", "scopePrefix", "fileReport", "exportReport"],
};
const CHECK_FIELDS = new Set([
	"textRegex",
	"flags",
	"textIncludes",
	"kind",
	"kindNot",
	"specifierExact",
	"specifierNot",
	"specifierPrefix",
	"specifierPrefixFrom",
	"targetExact",
	"targetNotExact",
	"namesIncludes",
	"edges",
	"import",
	"fileText",
	"filePresent",
]);
const IMPORT_FIELDS = new Set(["specifier", "name"]);
const FILE_TEXT_FIELDS = new Set(["path", "regex", "flags"]);
const EDGE_FIELDS = new Set(["specifierPrefix", "specifierPrefixFrom", "specifierExact", "namesIncludes"]);

export class CodingAgentDocumentError extends Error {
	constructor(source, message) {
		super(`${source}: ${message}`);
		this.name = "CodingAgentDocumentError";
	}
}

function fail(source, message) {
	throw new CodingAgentDocumentError(source, message);
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

function stringList(value, source, label) {
	if (!Array.isArray(value) || value.length === 0) fail(source, `${label} must be a non-empty list`);
	return value.map((item, index) => requiredText(item, source, `${label}[${index}]`));
}

function optionalStringList(value, source, label) {
	if (value === undefined) return [];
	if (typeof value === "string") return [requiredText(value, source, label)];
	return stringList(value, source, label);
}

function oneOrMore(value, source, label) {
	if (typeof value === "string") return [requiredText(value, source, label)];
	return stringList(value, source, label);
}

function lookupList(lists, name, source, label) {
	const value = lists[name];
	if (!value) fail(source, `${label} references unknown list ${name}`);
	return value;
}

function resolveStrings(inline, from, lists, source, label) {
	const values = inline === undefined ? [] : oneOrMore(inline, source, label);
	for (const name of optionalStringList(from, source, `${label}From`)) {
		values.push(...lookupList(lists, name, source, label));
	}
	return values;
}

function compilePattern(pattern, flags, source, label) {
	const sourceText = requiredText(pattern, source, label);
	const flagText = flags ?? "";
	if (typeof flagText !== "string") fail(source, `${label} flags must be a string`);
	if (sourceText.includes("{")) return { source: sourceText, flags: flagText, regex: null };
	try {
		return { source: sourceText, flags: flagText, regex: new RegExp(sourceText, flagText) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(source, `${label} is not a valid regular expression (${message})`);
	}
	return { source: sourceText, flags: flagText, regex: null };
}

function compileLists(value, source) {
	if (value === undefined) return {};
	if (!isPlainObject(value)) fail(source, "lists must be a mapping");
	const lists = {};
	for (const [name, items] of Object.entries(value)) lists[name] = stringList(items, source, `lists.${name}`);
	return lists;
}

function compileGroups(value, source) {
	if (value === undefined) return {};
	if (!isPlainObject(value)) fail(source, "groups must be a mapping");
	const groups = {};
	for (const [name, items] of Object.entries(value)) {
		if (!Array.isArray(items) || items.length === 0) fail(source, `groups.${name} must be a non-empty list`);
		groups[name] = items.map((item, index) => {
			if (!isPlainObject(item)) fail(source, `groups.${name}[${index}] must be a mapping`);
			const path = requiredText(item.path, source, `groups.${name}[${index}].path`);
			const compiled = { path };
			for (const [key, field] of Object.entries(item)) {
				if (key === "path") continue;
				compiled[key] = requiredText(field, source, `groups.${name}[${index}].${key}`);
			}
			return compiled;
		});
	}
	return groups;
}

function compileClause(clause, source, label, getClass) {
	if (!isPlainObject(clause)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(clause, CLAUSE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const specified = ["prefix", "exact", "suffix", "class", "not", "anyPrefix"].filter(
		(key) => clause[key] !== undefined,
	);
	if (specified.length !== 1) fail(source, `${label} needs exactly one matcher`);
	if (clause.prefix !== undefined) {
		const prefix = requiredText(clause.prefix, source, `${label}.prefix`);
		return (path) => path.startsWith(prefix);
	}
	if (clause.exact !== undefined) {
		const exact = requiredText(clause.exact, source, `${label}.exact`);
		return (path) => path === exact;
	}
	if (clause.suffix !== undefined) {
		const suffix = requiredText(clause.suffix, source, `${label}.suffix`);
		return (path) => path.endsWith(suffix);
	}
	if (clause.class !== undefined) {
		const name = requiredText(clause.class, source, `${label}.class`);
		return (path) => getClass(name)(path);
	}
	if (clause.not !== undefined) {
		const name = requiredText(clause.not, source, `${label}.not`);
		return (path) => !getClass(name)(path);
	}
	const prefixes = stringList(clause.anyPrefix, source, `${label}.anyPrefix`);
	return (path) => prefixes.some((prefix) => path.startsWith(prefix));
}

function compileClasses(value, source) {
	if (!isPlainObject(value)) fail(source, "classes must be a mapping");
	const compiled = new Map();
	const stack = [];
	function getClass(name) {
		if (!Object.hasOwn(value, name)) fail(source, `unknown class ${name}`);
		const existing = compiled.get(name);
		if (existing) return existing;
		if (stack.includes(name)) fail(source, `class ${name} is cyclic`);
		const definition = value[name];
		if (!isPlainObject(definition)) fail(source, `classes.${name} must be a mapping`);
		const unknown = unknownField(definition, CLASS_FIELDS);
		if (unknown) fail(source, `classes.${name} has unknown field "${unknown}"`);
		stack.push(name);
		let matcher;
		if (Array.isArray(definition.anyClass)) {
			const names = stringList(definition.anyClass, source, `classes.${name}.anyClass`);
			const refs = names.map((className) => getClass(className));
			matcher = (path) => refs.some((ref) => ref(path));
		} else if (Array.isArray(definition.any)) {
			const clauses = definition.any.map((clause, index) =>
				compileClause(clause, source, `classes.${name}.any[${index}]`, getClass),
			);
			matcher = (path) => clauses.some((clause) => clause(path));
		} else if (Array.isArray(definition.all)) {
			const clauses = definition.all.map((clause, index) =>
				compileClause(clause, source, `classes.${name}.all[${index}]`, getClass),
			);
			matcher = (path) => clauses.every((clause) => clause(path));
		} else {
			fail(source, `classes.${name} needs any, all, or anyClass`);
		}
		stack.pop();
		compiled.set(name, matcher);
		return matcher;
	}
	for (const name of Object.keys(value)) getClass(name);
	return Object.fromEntries(compiled);
}

function compileScan(value, source) {
	if (!isPlainObject(value)) fail(source, "scan must be a mapping");
	const unknown = unknownField(value, SCAN_FIELDS);
	if (unknown) fail(source, `scan has unknown field "${unknown}"`);
	return {
		sourceRoot: requiredText(value.sourceRoot, source, "scan.sourceRoot"),
		sourceExtensions: stringList(value.sourceExtensions, source, "scan.sourceExtensions"),
		consumerRoots: stringList(value.consumerRoots, source, "scan.consumerRoots"),
		consumerExtensions: stringList(value.consumerExtensions, source, "scan.consumerExtensions"),
		skipContains: stringList(value.skipContains, source, "scan.skipContains"),
		consumerTextIncludes: stringList(value.consumerTextIncludes, source, "scan.consumerTextIncludes"),
		consumerPaths: optionalStringList(value.consumerPaths, source, "scan.consumerPaths"),
		consumerPrefixes: optionalStringList(value.consumerPrefixes, source, "scan.consumerPrefixes"),
	};
}

function compilePackage(value, source) {
	if (!isPlainObject(value)) fail(source, "package must be a mapping");
	const unknown = unknownField(value, PACKAGE_FIELDS);
	if (unknown) fail(source, `package has unknown field "${unknown}"`);
	return {
		root: requiredText(value.root, source, "package.root"),
		sourceRoot: requiredText(value.sourceRoot, source, "package.sourceRoot"),
		specifier: requiredText(value.specifier, source, "package.specifier"),
		manifest: requiredText(value.manifest, source, "package.manifest"),
	};
}

function compileComposition(value, source) {
	if (!isPlainObject(value)) fail(source, "compositionPublic must be a mapping");
	const unknown = unknownField(value, COMPOSITION_FIELDS);
	if (unknown) fail(source, `compositionPublic has unknown field "${unknown}"`);
	return {
		sameDirectory: requiredText(value.sameDirectory, source, "compositionPublic.sameDirectory"),
		prefixes: stringList(value.prefixes, source, "compositionPublic.prefixes"),
		externalSpecifiers: stringList(value.externalSpecifiers, source, "compositionPublic.externalSpecifiers"),
	};
}

function assignList(when, raw, key, lists, source, label) {
	const values = resolveStrings(raw[key], raw[`${key}From`], lists, source, `${label}.${key}`);
	if (values.length > 0) when[key] = values;
}

function knownClass(name, classNames, source, label) {
	if (!classNames.has(name)) fail(source, `${label} references unknown class ${name}`);
}

function compileWhen(raw, lists, classNames, source, label) {
	const when = {};
	for (const key of [
		"pathPrefix",
		"pathExact",
		"pathSuffix",
		"pathNotPrefix",
		"pathNotExact",
		"specifierPrefix",
		"targetPrefix",
		"targetClassAny",
	]) {
		assignList(when, raw, key, lists, source, label);
	}
	for (const key of [
		"pathClass",
		"pathNotClass",
		"textIncludes",
		"specifierExact",
		"specifierNot",
		"kind",
		"kindNot",
		"namesIncludes",
		"targetExact",
		"targetNotExact",
		"targetClass",
	]) {
		if (raw[key] !== undefined) when[key] = requiredText(raw[key], source, `${label}.${key}`);
	}
	if (when.pathClass) knownClass(when.pathClass, classNames, source, `${label}.pathClass`);
	if (when.pathNotClass) knownClass(when.pathNotClass, classNames, source, `${label}.pathNotClass`);
	if (when.targetClass) knownClass(when.targetClass, classNames, source, `${label}.targetClass`);
	for (const name of when.targetClassAny ?? []) knownClass(name, classNames, source, `${label}.targetClassAny`);
	if (raw.textRegex !== undefined)
		when.textRegex = compilePattern(raw.textRegex, raw.flags, source, `${label}.textRegex`);
	if (raw.textRegexAny !== undefined) {
		when.textRegexAny = oneOrMore(raw.textRegexAny, source, `${label}.textRegexAny`).map((pattern, index) =>
			compilePattern(pattern, raw.flags, source, `${label}.textRegexAny[${index}]`),
		);
	}
	for (const key of ["outsidePackage", "specifierPackagePrefix", "unpublished", "notCompositionPublic"]) {
		if (raw[key] === undefined) continue;
		if (raw[key] !== true) fail(source, `${label}.${key} must be true`);
		when[key] = true;
	}
	return when;
}

function whenIsEmpty(when) {
	return Object.keys(when).length === 0;
}

function compileEdgeWhen(value, lists, classNames, source, label) {
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(value, EDGE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const when = compileWhen(value, lists, classNames, source, label);
	if (whenIsEmpty(when)) fail(source, `${label} needs a specifier or name test`);
	return when;
}

function compileWhenCheck(check, lists, classNames, source, label) {
	if (!isPlainObject(check)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(check, CHECK_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	if (check.edges !== undefined) {
		if (Object.keys(check).some((key) => key !== "edges")) fail(source, `${label}.edges cannot be combined`);
		return { edges: compileEdgeWhen(check.edges, lists, classNames, source, `${label}.edges`) };
	}
	if (check.import !== undefined || check.fileText !== undefined || check.filePresent !== undefined) {
		fail(source, `${label} is only valid inside unlessAll or unlessAny`);
	}
	const when = compileWhen(check, lists, classNames, source, label);
	if (whenIsEmpty(when)) fail(source, `${label} needs a test`);
	return { when };
}

function compileUnlessCheck(check, lists, classNames, source, label) {
	if (!isPlainObject(check)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(check, CHECK_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	if (check.import !== undefined) {
		if (!isPlainObject(check.import)) fail(source, `${label}.import must be a mapping`);
		const extra = unknownField(check.import, IMPORT_FIELDS);
		if (extra) fail(source, `${label}.import has unknown field "${extra}"`);
		return {
			import: {
				specifier: optionalText(check.import.specifier, source, `${label}.import.specifier`),
				name: requiredText(check.import.name, source, `${label}.import.name`),
			},
		};
	}
	if (check.fileText !== undefined) {
		if (!isPlainObject(check.fileText)) fail(source, `${label}.fileText must be a mapping`);
		const extra = unknownField(check.fileText, FILE_TEXT_FIELDS);
		if (extra) fail(source, `${label}.fileText has unknown field "${extra}"`);
		return {
			fileText: {
				path: requiredText(check.fileText.path, source, `${label}.fileText.path`),
				pattern: compilePattern(check.fileText.regex, check.fileText.flags, source, `${label}.fileText.regex`),
			},
		};
	}
	if (check.filePresent !== undefined) {
		return { filePresent: requiredText(check.filePresent, source, `${label}.filePresent`) };
	}
	if (check.edges !== undefined) fail(source, `${label}.edges is only valid inside whenAny`);
	const when = compileWhen(check, lists, classNames, source, label);
	if (whenIsEmpty(when)) fail(source, `${label} needs a test`);
	return { when };
}

function compileChecks(value, lists, classNames, source, label, compileOne) {
	if (!Array.isArray(value) || value.length === 0) fail(source, `${label} must be a non-empty list`);
	return value.map((check, index) => compileOne(check, lists, classNames, source, `${label}[${index}]`));
}

function lookupItems(name, lists, groups, source, label) {
	if (groups[name]) return groups[name];
	if (lists[name]) return lists[name].map((path) => ({ path }));
	fail(source, `${label} references unknown items ${name}`);
	return [];
}

function compileItems(step, lists, groups, source, label) {
	const inline = Array.isArray(step.items)
		? step.items.map((item, index) => {
				if (typeof item === "string") return { path: requiredText(item, source, `${label}.items[${index}]`) };
				if (!isPlainObject(item)) fail(source, `${label}.items[${index}] must be a string or mapping`);
				const compiled = { path: requiredText(item.path, source, `${label}.items[${index}].path`) };
				for (const [key, field] of Object.entries(item)) {
					if (key === "path") continue;
					compiled[key] = requiredText(field, source, `${label}.items[${index}].${key}`);
				}
				return compiled;
			})
		: [];
	for (const name of optionalStringList(step.itemsFrom, source, `${label}.itemsFrom`)) {
		inline.push(...lookupItems(name, lists, groups, source, `${label}.itemsFrom`));
	}
	if (inline.length === 0) fail(source, `${label} needs items or itemsFrom`);
	return inline;
}

function compileStep(step, lists, groups, classNames, source, label) {
	if (!isPlainObject(step)) fail(source, `${label} must be a mapping`);
	const op = requiredText(step.op, source, `${label}.op`);
	const specific = STEP_FIELDS[op];
	if (!specific) fail(source, `${label}.op is not supported (${op})`);
	const allowed = new Set(["op", ...specific, ...(op === "when" || op === "whenAny" ? WHEN_FIELDS : [])]);
	const unknown = unknownField(step, allowed);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const compiled = { op };
	const stepsRequired = [
		"eachFile",
		"eachEdge",
		"eachSourcePath",
		"eachExport",
		"eachItem",
		"file",
		"whenTargetInside",
	];
	if (Array.isArray(step.steps)) {
		if (step.steps.length === 0) fail(source, `${label}.steps must be a non-empty list`);
		compiled.steps = step.steps.map((child, index) =>
			compileStep(child, lists, groups, classNames, source, `${label}.steps[${index}]`),
		);
	} else if (stepsRequired.includes(op)) {
		fail(source, `${label}.steps must be a non-empty list`);
	}
	if (op === "when" || op === "whenAny") compiled.when = compileWhen(step, lists, classNames, source, label);
	if (op === "when" && whenIsEmpty(compiled.when)) fail(source, `${label} needs a condition`);
	if (op === "whenAny") {
		compiled.checks = compileChecks(step.checks, lists, classNames, source, `${label}.checks`, compileWhenCheck);
	}
	if (step.report !== undefined) compiled.report = requiredText(step.report, source, `${label}.report`);
	const reportRequired = [
		"eachText",
		"ifSourceHas",
		"ifExport",
		"unlessAll",
		"unlessAny",
		"unlessText",
		"unlessImport",
	];
	if (reportRequired.includes(op) && compiled.report === undefined) fail(source, `${label}.report is required`);
	if (op === "eachText")
		compiled.includes = resolveStrings(step.includes, step.includesFrom, lists, source, `${label}.includes`);
	if (op === "eachText" && compiled.includes.length === 0) fail(source, `${label} needs includes or includesFrom`);
	if (op === "ifSourceHas") {
		compiled.paths = resolveStrings(step.paths, step.pathsFrom, lists, source, `${label}.paths`);
		if (compiled.paths.length === 0) fail(source, `${label} needs paths or pathsFrom`);
	}
	if (op === "ifExport") {
		compiled.names = resolveStrings(step.names, step.namesFrom, lists, source, `${label}.names`);
		if (compiled.names.length === 0) fail(source, `${label} needs names or namesFrom`);
	}
	if (op === "eachItem") {
		compiled.items = compileItems(step, lists, groups, source, label);
		compiled.skipIfAbsent = step.skipIfAbsent === true;
	}
	if (op === "file") compiled.path = requiredText(step.path, source, `${label}.path`);
	if (op === "unlessAll" || op === "unlessAny") {
		compiled.checks = compileChecks(step.checks, lists, classNames, source, `${label}.checks`, compileUnlessCheck);
	}
	if (op === "unlessText") compiled.pattern = compilePattern(step.regex, step.flags, source, `${label}.regex`);
	if (op === "unlessImport") {
		compiled.specifier = optionalText(step.specifier, source, `${label}.specifier`);
		compiled.name = requiredText(step.name, source, `${label}.name`);
	}
	if (op === "retiredTerm") {
		compiled.term = requiredText(step.term, source, `${label}.term`);
		compiled.scopePrefix = requiredText(step.scopePrefix, source, `${label}.scopePrefix`);
		compiled.fileReport = requiredText(step.fileReport, source, `${label}.fileReport`);
		compiled.exportReport = requiredText(step.exportReport, source, `${label}.exportReport`);
	}
	if ((op === "when" || op === "whenAny") && compiled.report === undefined && compiled.steps === undefined) {
		fail(source, `${label} needs report or steps`);
	}
	return compiled;
}

function compileRules(value, lists, groups, classNames, source) {
	if (!Array.isArray(value) || value.length === 0) fail(source, "rules must be a non-empty list");
	const seen = new Set();
	return value.map((rule, index) => {
		const label = `rules[${index}]`;
		if (!isPlainObject(rule)) fail(source, `${label} must be a mapping`);
		const unknown = unknownField(rule, new Set(["name", "doc", "steps"]));
		if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
		const name = requiredText(rule.name, source, `${label}.name`);
		if (seen.has(name)) fail(source, `${label}.name duplicates ${name}`);
		seen.add(name);
		if (!Array.isArray(rule.steps) || rule.steps.length === 0)
			fail(source, `${label}.steps must be a non-empty list`);
		return {
			name,
			doc: optionalText(rule.doc, source, `${label}.doc`) ?? "",
			steps: rule.steps.map((step, stepIndex) =>
				compileStep(step, lists, groups, classNames, source, `${label}.steps[${stepIndex}]`),
			),
		};
	});
}

function validateDocument(value, source) {
	if (!isPlainObject(value)) fail(source, "rule document must be a mapping");
	const unknown = unknownField(value, DOCUMENT_FIELDS);
	if (unknown) fail(source, `unknown field "${unknown}"`);
	const name = requiredText(value.name, source, "name");
	const description = requiredText(value.description, source, "description");
	const rationale = requiredText(value.rationale, source, "rationale");
	const docs = stringList(value.docs, source, "docs");
	const examples = Array.isArray(value.examples) ? value.examples : fail(source, "examples must be a list");
	const lists = compileLists(value.lists, source);
	const groups = compileGroups(value.groups, source);
	const classes = compileClasses(value.classes, source);
	return {
		name,
		description,
		rationale,
		docs,
		examples: examples.map((example, index) => {
			if (!isPlainObject(example)) fail(source, `examples[${index}] must be a mapping`);
			const extra = unknownField(example, EXAMPLE_FIELDS);
			if (extra) fail(source, `examples[${index}] has unknown field "${extra}"`);
			return {
				violation: requiredText(example.violation, source, `examples[${index}].violation`),
				fix: requiredText(example.fix, source, `examples[${index}].fix`),
			};
		}),
		package: compilePackage(value.package, source),
		classes,
		compositionPublic: compileComposition(value.compositionPublic, source),
		scan: compileScan(value.scan, source),
		rules: compileRules(value.rules, lists, groups, new Set(Object.keys(classes)), source),
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

/** Parse one Coding Agent architecture document. `sourceName` is included in errors. */
export function parseCodingAgentDocument(text, sourceName = "<inline>") {
	return validateDocument(parseYaml(text, sourceName), sourceName);
}

/** Read and compile the Coding Agent architecture YAML. */
export function loadCodingAgentDocument(filePath) {
	let text;
	try {
		text = readFileSync(filePath, "utf8");
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
		throw new CodingAgentDocumentError(filePath, `unable to read rule file (${code})`);
	}
	return parseCodingAgentDocument(text, filePath);
}

function scriptKind(path) {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function collectImportNames(clause) {
	if (!clause) return ["<side-effect>"];
	const names = [];
	if (clause.name) names.push("default");
	if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
	}
	if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push("*");
	return names;
}

function collectExportNames(clause) {
	if (!clause || !ts.isNamedExports(clause)) return ["*"];
	return clause.elements.map((element) => element.name.text);
}

function collectModuleEdges(file) {
	if (!/\.[cm]?[jt]sx?$/.test(file.path)) return [];
	const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
	const edges = [];
	const addEdge = (node, moduleSpecifier, kind, names) => {
		if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) return;
		edges.push({
			path: file.path,
			specifier: moduleSpecifier.text,
			kind,
			names,
			line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
		});
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node)) {
			addEdge(node, node.moduleSpecifier, "import", collectImportNames(node.importClause));
		} else if (ts.isExportDeclaration(node)) {
			addEdge(node, node.moduleSpecifier, "export", collectExportNames(node.exportClause));
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1
		) {
			addEdge(node, node.arguments[0], "dynamic-import", ["<dynamic>"]);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return edges;
}

/** Build the same state object the legacy checker evaluates. `sourceRoot` selects Coding Agent sources. */
export function collectCodingAgentArchitectureState({ files, packageJson }, sourceRoot = "packages/coding-agent/src") {
	const normalizedFiles = files.map((file) => ({ ...file, path: toPosix(file.path) }));
	const edges = normalizedFiles.flatMap(collectModuleEdges);
	const sourcePrefix = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
	const sourcePaths = normalizedFiles
		.filter((file) => file.path.startsWith(sourcePrefix))
		.map((file) => file.path)
		.sort();
	return Object.freeze({
		files: normalizedFiles,
		edges,
		sourcePaths,
		packageExports: Object.keys(packageJson.exports ?? {}).sort(),
	});
}

function resolveSourceTarget(sourcePath, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	return posix.normalize(posix.join(posix.dirname(sourcePath), specifier)).replace(/\.js$/, ".ts");
}

function matchesExportSubpath(publishedSubpath, requestedSubpath) {
	if (publishedSubpath === requestedSubpath) return true;
	const wildcardIndex = publishedSubpath.indexOf("*");
	if (wildcardIndex < 0) return false;
	return (
		requestedSubpath.startsWith(publishedSubpath.slice(0, wildcardIndex)) &&
		requestedSubpath.endsWith(publishedSubpath.slice(wildcardIndex + 1))
	);
}

function isPublished(specifier, packageExports, pkg) {
	if (specifier === pkg.specifier) return packageExports.includes(".");
	if (!specifier.startsWith(`${pkg.specifier}/`)) return false;
	const requestedSubpath = `./${specifier.slice(pkg.specifier.length + 1)}`;
	return packageExports.some((publishedSubpath) => matchesExportSubpath(publishedSubpath, requestedSubpath));
}

function isCompositionPublic(target, specifier, config) {
	if (!target) return config.externalSpecifiers.includes(specifier);
	if (posix.dirname(target) === config.sameDirectory) return true;
	return config.prefixes.some((root) => target.startsWith(root));
}

function render(template, ctx) {
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		if (key === "path") return ctx.path ?? "";
		if (key === "line") return String(ctx.line ?? "");
		if (key === "specifier") return ctx.edge?.specifier ?? "";
		if (key === "item") return typeof ctx.item === "string" ? ctx.item : "";
		if (key === "export") return ctx.exportName ?? "";
		if (key === "manifest") return ctx.spec.package.manifest;
		if (ctx.item && typeof ctx.item === "object" && Object.hasOwn(ctx.item, key)) return String(ctx.item[key]);
		return match;
	});
}

function regexOf(pattern, ctx) {
	if (pattern.regex) return pattern.regex;
	try {
		return new RegExp(render(pattern.source, ctx), pattern.flags);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CodingAgentDocumentError("<rule>", `regular expression failed to compile (${message})`);
	}
}

function matchWhen(when, ctx) {
	if (!when || whenIsEmpty(when)) return true;
	const path = ctx.path ?? "";
	if (when.pathPrefix && !when.pathPrefix.some((prefix) => path.startsWith(prefix))) return false;
	if (when.pathExact && !when.pathExact.includes(path)) return false;
	if (when.pathSuffix && !when.pathSuffix.some((suffix) => path.endsWith(suffix))) return false;
	if (when.pathNotPrefix?.some((prefix) => path.startsWith(prefix))) return false;
	if (when.pathNotExact?.includes(path)) return false;
	if (when.pathClass && !ctx.classes[when.pathClass](path)) return false;
	if (when.pathNotClass && ctx.classes[when.pathNotClass](path)) return false;
	const text = ctx.text ?? "";
	if (when.textIncludes !== undefined && !text.includes(render(when.textIncludes, ctx))) return false;
	if (when.textRegex && !regexOf(when.textRegex, ctx).test(text)) return false;
	if (when.textRegexAny && !when.textRegexAny.some((pattern) => regexOf(pattern, ctx).test(text))) return false;
	const edge = ctx.edge;
	const needsEdge =
		when.specifierPrefix ||
		when.specifierExact !== undefined ||
		when.specifierNot !== undefined ||
		when.kind ||
		when.kindNot ||
		when.namesIncludes ||
		when.specifierPackagePrefix ||
		when.unpublished ||
		when.notCompositionPublic;
	if (needsEdge && !edge) return false;
	if (when.specifierPrefix && !when.specifierPrefix.some((prefix) => edge.specifier.startsWith(render(prefix, ctx)))) {
		return false;
	}
	if (when.specifierExact !== undefined && edge.specifier !== render(when.specifierExact, ctx)) return false;
	if (when.specifierNot !== undefined && edge.specifier === render(when.specifierNot, ctx)) return false;
	if (when.kind && edge.kind !== when.kind) return false;
	if (when.kindNot && edge.kind === when.kindNot) return false;
	if (when.namesIncludes && !edge.names.includes(render(when.namesIncludes, ctx))) return false;
	if (when.outsidePackage && path.startsWith(`${ctx.spec.package.root}/`)) return false;
	if (when.specifierPackagePrefix && !edge.specifier.startsWith(ctx.spec.package.specifier)) return false;
	if (when.unpublished && isPublished(edge.specifier, ctx.state.packageExports, ctx.spec.package)) return false;
	if (when.targetExact !== undefined && ctx.target !== render(when.targetExact, ctx)) return false;
	if (when.targetNotExact !== undefined && ctx.target === render(when.targetNotExact, ctx)) return false;
	if (when.targetPrefix && !(ctx.target && when.targetPrefix.some((prefix) => ctx.target.startsWith(prefix))))
		return false;
	if (when.targetClass && !(ctx.target && ctx.classes[when.targetClass](ctx.target))) return false;
	if (when.targetClassAny && !(ctx.target && when.targetClassAny.some((name) => ctx.classes[name](ctx.target)))) {
		return false;
	}
	if (when.notCompositionPublic && isCompositionPublic(ctx.target, edge.specifier, ctx.spec.compositionPublic))
		return false;
	return true;
}

function emit(findings, rule, ctx, template) {
	const path = ctx.path ?? "";
	const line = ctx.edge?.line ?? ctx.line ?? 1;
	const text = render(template, { ...ctx, path, line });
	const withLine = `${path}:${line}: `;
	let message = text;
	let reportedLine = 1;
	if (text.startsWith(withLine)) {
		message = text.slice(withLine.length);
		reportedLine = line;
	} else if (text.startsWith(`${path}: `)) {
		message = text.slice(path.length + 2);
	} else if (text.startsWith(`${path} `)) {
		message = text.slice(path.length + 1);
	}
	findings.push({ text, file: path, line: reportedLine, rule: rule.name, message, doc: rule.doc });
}

function edgeContext(ctx, edge) {
	const file = ctx.filesByPath.get(edge.path);
	return {
		...ctx,
		edge,
		path: edge.path,
		text: file?.text ?? "",
		line: edge.line,
		target: resolveSourceTarget(edge.path, edge.specifier),
		item: undefined,
	};
}

function fileContext(ctx, file) {
	return {
		...ctx,
		file,
		path: file.path,
		text: file.text,
		line: 1,
		edge: undefined,
		target: undefined,
		item: undefined,
	};
}

function hasImport(ctx, specifier, name) {
	const renderedName = render(name, ctx);
	const renderedSpecifier = specifier === undefined ? undefined : render(specifier, ctx);
	return ctx.state.edges.some((edge) => {
		if (edge.path !== ctx.path) return false;
		if (renderedSpecifier !== undefined && edge.specifier !== renderedSpecifier) return false;
		return edge.names.includes(renderedName);
	});
}

function checkPasses(check, ctx) {
	if (check.when) return matchWhen(check.when, ctx);
	if (check.import) return hasImport(ctx, check.import.specifier, check.import.name);
	if (check.filePresent) return ctx.filesByPath.has(check.filePresent);
	if (check.fileText) {
		const file = ctx.filesByPath.get(check.fileText.path);
		if (!file) return false;
		return regexOf(check.fileText.pattern, ctx).test(file.text);
	}
	return false;
}

function runSteps(steps, ctx, findings, rule) {
	for (const step of steps) runStep(step, ctx, findings, rule);
}

function runStep(step, ctx, findings, rule) {
	if (step.op === "eachFile") {
		for (const file of ctx.state.files) runSteps(step.steps, fileContext(ctx, file), findings, rule);
		return;
	}
	if (step.op === "eachEdge") {
		for (const edge of ctx.state.edges) runSteps(step.steps, edgeContext(ctx, edge), findings, rule);
		return;
	}
	if (step.op === "eachSourcePath") {
		for (const path of ctx.state.sourcePaths) {
			const file = ctx.filesByPath.get(path);
			runSteps(
				step.steps,
				{ ...ctx, path, file, text: file?.text ?? "", line: 1, edge: undefined, target: undefined },
				findings,
				rule,
			);
		}
		return;
	}
	if (step.op === "eachExport") {
		for (const exportName of ctx.state.packageExports) {
			runSteps(
				step.steps,
				{
					...ctx,
					exportName,
					path: ctx.spec.package.manifest,
					text: exportName,
					line: 1,
					edge: undefined,
					target: undefined,
				},
				findings,
				rule,
			);
		}
		return;
	}
	if (step.op === "eachItem") {
		for (const item of step.items) {
			const file = ctx.filesByPath.get(item.path);
			if (step.skipIfAbsent && !file) continue;
			runSteps(
				step.steps,
				{
					...ctx,
					item,
					path: item.path,
					file,
					text: file?.text ?? "",
					line: 1,
					edge: undefined,
					target: undefined,
				},
				findings,
				rule,
			);
		}
		return;
	}
	if (step.op === "eachText") {
		for (const item of step.includes) {
			if ((ctx.text ?? "").includes(item)) emit(findings, rule, { ...ctx, item }, step.report);
		}
		return;
	}
	if (step.op === "ifSourceHas") {
		for (const path of step.paths) {
			if (ctx.state.sourcePaths.includes(path))
				emit(findings, rule, { ...ctx, path, line: 1, edge: undefined }, step.report);
		}
		return;
	}
	if (step.op === "ifExport") {
		for (const exportName of step.names) {
			if (!ctx.state.packageExports.includes(exportName)) continue;
			emit(
				findings,
				rule,
				{ ...ctx, path: ctx.spec.package.manifest, exportName, line: 1, edge: undefined },
				step.report,
			);
		}
		return;
	}
	if (step.op === "file") {
		const path = render(step.path, ctx);
		const file = ctx.filesByPath.get(path);
		if (!file) return;
		runSteps(step.steps, fileContext(ctx, file), findings, rule);
		return;
	}
	if (step.op === "when") {
		if (!matchWhen(step.when, ctx)) return;
		if (step.report) emit(findings, rule, ctx, step.report);
		if (step.steps) runSteps(step.steps, ctx, findings, rule);
		return;
	}
	if (step.op === "whenAny") {
		if (!matchWhen(step.when, ctx)) return;
		const matched = step.checks.some((check) => {
			if (!check.edges) return matchWhen(check.when, ctx);
			return ctx.state.edges.some(
				(edge) => edge.path === ctx.path && matchWhen(check.edges, edgeContext(ctx, edge)),
			);
		});
		if (!matched) return;
		if (step.report) emit(findings, rule, ctx, step.report);
		if (step.steps) runSteps(step.steps, ctx, findings, rule);
		return;
	}
	if (step.op === "whenTargetInside") {
		if (!ctx.target?.startsWith(`${ctx.spec.package.sourceRoot}/`)) return;
		runSteps(step.steps, ctx, findings, rule);
		return;
	}
	if (step.op === "unlessAll") {
		if (step.checks.every((check) => checkPasses(check, ctx))) return;
		emit(findings, rule, ctx, step.report);
		return;
	}
	if (step.op === "unlessAny") {
		if (step.checks.some((check) => checkPasses(check, ctx))) return;
		emit(findings, rule, ctx, step.report);
		return;
	}
	if (step.op === "unlessText") {
		if (regexOf(step.pattern, ctx).test(ctx.text ?? "")) return;
		emit(findings, rule, ctx, step.report);
		return;
	}
	if (step.op === "unlessImport") {
		if (hasImport(ctx, step.specifier, step.name)) return;
		emit(findings, rule, ctx, step.report);
		return;
	}
	if (step.op === "retiredTerm") {
		const escaped = step.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const capital = escaped[0].toUpperCase() + escaped.slice(1);
		const pattern = new RegExp(`\\b${escaped}\\b|\\b${escaped}[A-Z]|\\b${capital}[A-Z]|\\b${escaped}[-_]`);
		for (const file of ctx.state.files) {
			if (!file.path.startsWith(step.scopePrefix)) continue;
			if (!pattern.test(file.path) && !pattern.test(file.text)) continue;
			emit(findings, rule, fileContext(ctx, file), step.fileReport);
		}
		for (const exportName of ctx.state.packageExports) {
			if (!pattern.test(exportName)) continue;
			emit(
				findings,
				rule,
				{ ...ctx, exportName, path: ctx.spec.package.manifest, line: 1, edge: undefined },
				step.exportReport,
			);
		}
	}
}

/** Run the document and return findings. `text` is the legacy violation string. */
export function evaluateCodingAgentArchitecture(document, state) {
	if (!document || !Array.isArray(document.rules)) fail("<document>", "rules must be a list");
	if (!state || !Array.isArray(state.files) || !Array.isArray(state.edges)) fail("<state>", "state is incomplete");
	const findings = [];
	const ctx = {
		spec: document,
		state,
		classes: document.classes,
		filesByPath: new Map(state.files.map((file) => [file.path, file])),
	};
	for (const rule of document.rules) runSteps(rule.steps, ctx, findings, rule);
	return findings;
}
