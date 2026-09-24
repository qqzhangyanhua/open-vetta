/**
 * Package-boundary rules loaded from YAML.
 *
 * File selection goes through the architecture engine's glob matcher.
 * Import and syntax checks walk the engine's plain AST. Finding order
 * follows the rule list, which is the order of the legacy checker.
 * Returned messages stay `path: text` so existing callers keep their contract.
 * `fix` is the repair note from the rule; the CLI prints it on failure.
 */

import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { lineNumberAt, toPosix } from "../lib.mjs";
import { parseSource, walkAst } from "./ast-walker.mjs";
import { matchesGlobs } from "./rule-engine.mjs";

const TEST_SUFFIX = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_TREE = /(?:^|\/)test(?:\/|$)/;

const DOCUMENT_FIELDS = new Set([
	"name",
	"description",
	"rationale",
	"examples",
	"lists",
	"scan",
	"rules",
	"manifests",
]);
const EXAMPLE_FIELDS = new Set(["violation", "fix"]);
const SCAN_FIELDS = new Set(["roots", "entryPaths", "skipContains"]);
const RULE_FIELDS = new Set([
	"name",
	"scope",
	"whenNoFindings",
	"bannedPath",
	"textIncludes",
	"textGate",
	"imports",
	"walk",
	"exportSurface",
	"interfaceMember",
	"manifestImport",
	"phases",
	"report",
	"fix",
]);
const SCOPE_FIELDS = new Set([
	"prefix",
	"prefixFrom",
	"path",
	"pathFrom",
	"suffix",
	"notPrefix",
	"notPath",
	"notSuffix",
	"excludeTestFile",
	"excludeTestSuffix",
	"requireSrc",
]);
const WHERE_FIELDS = new Set([
	"appId",
	"testTree",
	"prefix",
	"startsWith",
	"includes",
	"regex",
	"exact",
	"skipExact",
	"skipWhenPrefix",
	"whereAny",
]);
const WALK_FIELDS = new Set([
	"kind",
	"names",
	"namesFrom",
	"patterns",
	"flags",
	"object",
	"property",
	"once",
	"initializer",
	"chainObject",
	"chainNames",
	"declarationKinds",
	"unique",
	"order",
	"report",
	"match",
]);
const WALK_KINDS = new Set([
	"identifier",
	"literal",
	"literalPattern",
	"propertyAccess",
	"new",
	"call",
	"propertyAssignment",
	"accessChain",
	"declaration",
	"bucket",
]);

export class BoundaryDocumentError extends Error {
	constructor(source, message) {
		super(`${source}: ${message}`);
		this.name = "BoundaryDocumentError";
	}
}

function fail(source, message) {
	throw new BoundaryDocumentError(source, message);
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

function optionalStringList(value, source, label) {
	if (value === undefined) return [];
	return stringList(value, source, label);
}

function lookupList(lists, name, source, label) {
	const value = lists[name];
	if (!value) fail(source, `${label} references unknown list ${name}`);
	return value;
}

function resolveStrings(inline, from, lists, source, label) {
	const values = [...optionalStringList(inline, source, label)];
	for (const name of optionalStringList(from, source, `${label}From`)) {
		values.push(...lookupList(lists, name, source, label));
	}
	return values;
}

function compileRegex(pattern, flags, source, label) {
	try {
		return new RegExp(pattern, flags ?? "");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(source, `${label} is not a valid regular expression (${message})`);
	}
}

function compileScope(scope, lists, source, label) {
	if (scope === undefined) return null;
	if (!isPlainObject(scope)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(scope, SCOPE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const prefix = resolveStrings(scope.prefix, scope.prefixFrom, lists, source, `${label}.prefix`);
	const path = resolveStrings(scope.path, scope.pathFrom, lists, source, `${label}.path`);
	const suffix = optionalStringList(scope.suffix, source, `${label}.suffix`);
	const positives = [...prefix.map((item) => `${item.replace(/\/$/, "")}/**`), ...path];
	const negatives = [
		...optionalStringList(scope.notPrefix, source, `${label}.notPrefix`).map(
			(item) => `!${item.replace(/\/$/, "")}/**`,
		),
		...optionalStringList(scope.notPath, source, `${label}.notPath`).map((item) => `!${item}`),
		...optionalStringList(scope.notSuffix, source, `${label}.notSuffix`).map((item) => `!**/*${item}`),
	];
	let sources = null;
	if (positives.length > 0) sources = [...positives, ...negatives];
	else if (negatives.length > 0) sources = ["**", ...negatives];
	return {
		sources,
		suffix,
		requireSrc: scope.requireSrc === true,
		excludeTestFile: scope.excludeTestFile === true,
		excludeTestSuffix: scope.excludeTestSuffix === true,
	};
}

function negativesBlock(sources, path) {
	if (!sources) return false;
	const negatives = sources.filter((pattern) => pattern.startsWith("!"));
	if (negatives.length === 0) return false;
	return !matchesGlobs(path, ["**", ...negatives]);
}

function pathInScope(scope, path) {
	if (!scope) return true;
	if (scope.excludeTestSuffix && TEST_SUFFIX.test(path)) return false;
	if (scope.excludeTestFile && (path.includes("/test/") || TEST_SUFFIX.test(path))) return false;
	if (scope.requireSrc && !path.includes("/src/")) return false;
	if (negativesBlock(scope.sources, path)) return false;
	const positives = (scope.sources ?? []).filter((pattern) => !pattern.startsWith("!"));
	const globMatch = positives.length > 0 ? matchesGlobs(path, positives) : false;
	const suffixMatch = scope.suffix.some((suffix) => path.endsWith(suffix));
	if (positives.length === 0 && scope.suffix.length === 0) return true;
	return globMatch || suffixMatch;
}

function compileAppId(value, source, label) {
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const packages = stringList(value.packages, source, `${label}.packages`);
	const segments = stringList(value.segments, source, `${label}.segments`);
	return { packages, pattern: new RegExp(`(?:^|/)(${segments.join("|")})(?:/|$)`) };
}

function compileWhere(where, source, label) {
	if (!isPlainObject(where)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(where, WHERE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const compiled = {
		appId: where.appId === undefined ? null : compileAppId(where.appId, source, `${label}.appId`),
		testTree: where.testTree === true,
		prefix: optionalStringList(where.prefix, source, `${label}.prefix`),
		startsWith: optionalStringList(where.startsWith, source, `${label}.startsWith`),
		includes: optionalStringList(where.includes, source, `${label}.includes`),
		regex: where.regex === undefined ? null : compileRegex(where.regex, "", source, `${label}.regex`),
		exact: new Set(optionalStringList(where.exact, source, `${label}.exact`)),
		skipExact: new Set(optionalStringList(where.skipExact, source, `${label}.skipExact`)),
		skipWhenPrefix: optionalStringList(where.skipWhenPrefix, source, `${label}.skipWhenPrefix`),
		whereAny: Array.isArray(where.whereAny)
			? where.whereAny.map((item, index) => compileWhere(item, source, `${label}.whereAny[${index}]`))
			: null,
	};
	const specified = [
		compiled.appId,
		compiled.testTree,
		compiled.prefix.length,
		compiled.startsWith.length,
		compiled.includes.length,
		compiled.regex,
		compiled.exact.size,
		compiled.whereAny,
	].some(Boolean);
	if (!specified) fail(source, `${label} needs a specifier test`);
	return compiled;
}

function compileClause(clause, source, label) {
	if (!isPlainObject(clause)) fail(source, `${label} must be a mapping`);
	const allowed = new Set(["where", "whereAny", "unlessPaths", "unlessPathsFrom", "whenText", "report"]);
	const unknown = unknownField(clause, allowed);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const where = {
		...(isPlainObject(clause.where) ? clause.where : {}),
		...(clause.whereAny ? { whereAny: clause.whereAny } : {}),
	};
	if (!clause.where && !clause.whereAny) fail(source, `${label} needs where or whereAny`);
	return {
		where: compileWhere(where, source, `${label}.where`),
		unlessPaths: new Set(optionalStringList(clause.unlessPaths, source, `${label}.unlessPaths`)),
		whenText: clause.whenText === undefined ? null : compileRegex(clause.whenText, "", source, `${label}.whenText`),
		report: requiredText(clause.report, source, `${label}.report`),
	};
}

function compileImports(value, lists, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(value, new Set(["runtime", "once", "clauses"]));
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const once = value.once ?? "each";
	if (once !== "each" && once !== "first" && once !== "any") fail(source, `${label}.once must be each, first, or any`);
	const clauses = asList(value.clauses, source, `${label}.clauses`).map((clause, index) => {
		const compiled = compileClause(clause, source, `${label}.clauses[${index}]`);
		for (const name of optionalStringList(clause.unlessPathsFrom, source, `${label}.unlessPathsFrom`)) {
			for (const path of lookupList(lists, name, source, name)) compiled.unlessPaths.add(path);
		}
		return compiled;
	});
	return { runtime: value.runtime === true, once, clauses };
}

function compileWalkItem(item, lists, source, label) {
	if (!isPlainObject(item)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(item, WALK_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const kind = requiredText(item.kind, source, `${label}.kind`);
	if (!WALK_KINDS.has(kind)) fail(source, `${label}.kind is not supported (${kind})`);
	const names = resolveStrings(item.names, item.namesFrom, lists, source, `${label}.names`);
	const patterns = optionalStringList(item.patterns, source, `${label}.patterns`).map((pattern, index) =>
		compileRegex(pattern, item.flags, source, `${label}.patterns[${index}]`),
	);
	const order = item.order ?? "seen";
	if (order !== "seen" && order !== "listed") fail(source, `${label}.order must be seen or listed`);
	const compiled = {
		kind,
		names: new Set(names),
		listed: names,
		patterns,
		object: optionalText(item.object, source, `${label}.object`),
		property: optionalText(item.property, source, `${label}.property`),
		once: item.once === true,
		initializer: item.initializer,
		chainObject: optionalText(item.chainObject, source, `${label}.chainObject`),
		chainNames: new Set(optionalStringList(item.chainNames, source, `${label}.chainNames`)),
		declarationKinds: new Set(optionalStringList(item.declarationKinds, source, `${label}.declarationKinds`)),
		unique: item.unique === true,
		order,
		report: item.report === undefined ? null : requiredText(item.report, source, `${label}.report`),
		match: Array.isArray(item.match)
			? item.match.map((child, index) => compileWalkItem(child, lists, source, `${label}.match[${index}]`))
			: null,
	};
	if (kind === "bucket") {
		if (!compiled.match || !compiled.report) fail(source, `${label} bucket needs match and report`);
	} else if (kind !== "bucket" && item.match) {
		fail(source, `${label}.match is only valid on a bucket`);
	}
	return compiled;
}

function compileWalk(value, lists, source, label) {
	if (value === undefined) return null;
	return asList(value, source, label).map((item, index) => compileWalkItem(item, lists, source, `${label}[${index}]`));
}

function compilePresent(value, lists, source, label) {
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const names = resolveStrings(value.names, value.namesFrom, lists, source, `${label}.names`);
	const order = value.order ?? "seen";
	if (order !== "seen" && order !== "listed") fail(source, `${label}.order must be seen or listed`);
	const skip = Array.isArray(value.skip)
		? value.skip.map((item, index) => {
				if (!isPlainObject(item)) fail(source, `${label}.skip[${index}] must be a mapping`);
				return {
					path: requiredText(item.path, source, `${label}.skip[${index}].path`),
					names: new Set(stringList(item.names, source, `${label}.skip[${index}].names`)),
				};
			})
		: [];
	return {
		id: requiredText(value.id, source, `${label}.id`),
		order,
		names: new Set(names),
		listed: names,
		report: requiredText(value.report, source, `${label}.report`),
		skip,
	};
}

function compilePhase(phase, lists, source, label) {
	if (!isPlainObject(phase)) fail(source, `${label} must be a mapping`);
	const allowed = new Set(["when", "stopWhen", "scan", "imports", "present"]);
	const unknown = unknownField(phase, allowed);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	return {
		when: compileScope(phase.when, lists, source, `${label}.when`),
		stopWhen: compileScope(phase.stopWhen, lists, source, `${label}.stopWhen`),
		scan: phase.scan === undefined ? null : requiredText(phase.scan, source, `${label}.scan`),
		imports: compileImports(phase.imports, lists, source, `${label}.imports`),
		present: phase.present === undefined ? null : compilePresent(phase.present, lists, source, `${label}.present`),
	};
}

function compileTextCheck(check, source, label) {
	if (!isPlainObject(check)) fail(source, `${label} must be a mapping`);
	const report = requiredText(check.report, source, `${label}.report`);
	if (check.regex !== undefined) {
		return { regex: compileRegex(check.regex, "", source, `${label}.regex`), report };
	}
	if (check.missing !== undefined) return { missing: requiredText(check.missing, source, `${label}.missing`), report };
	fail(source, `${label} needs regex or missing`);
	return { report };
}

function compileTextGate(value, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const checks = asList(value.checks, source, `${label}.checks`).map((check, index) =>
		compileTextCheck(check, source, `${label}.checks[${index}]`),
	);
	return { includes: requiredText(value.includes, source, `${label}.includes`), checks };
}

function compileExportSurface(value, lists, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const module = value.module;
	if (!isPlainObject(module)) fail(source, `${label}.module must be a mapping`);
	const names = resolveStrings(value.names, value.namesFrom, lists, source, `${label}.names`);
	return {
		module: {
			includes: optionalStringList(module.includes, source, `${label}.module.includes`),
			exact: new Set(optionalStringList(module.exact, source, `${label}.module.exact`)),
			prefix: optionalStringList(module.prefix, source, `${label}.module.prefix`),
			report: requiredText(module.report, source, `${label}.module.report`),
		},
		names: new Set(names),
		report: requiredText(value.report, source, `${label}.report`),
	};
}

function compileInterfaceMember(value, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	return {
		interfaceName: requiredText(value.interface, source, `${label}.interface`),
		property: requiredText(value.property, source, `${label}.property`),
		typeNot: requiredText(value.typeNot, source, `${label}.typeNot`),
		report: requiredText(value.report, source, `${label}.report`),
	};
}

function compileManifestImport(value, lists, source, label) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) fail(source, `${label} must be a mapping`);
	const packages = resolveStrings(value.packages, value.packagesFrom, lists, source, `${label}.packages`);
	return {
		packages: new Set(packages),
		scopes: stringList(value.scopes, source, `${label}.scopes`),
		report: requiredText(value.report, source, `${label}.report`),
	};
}

function compileRule(rule, lists, source, index) {
	const label = `rules[${index}]`;
	if (!isPlainObject(rule)) fail(source, `${label} must be a mapping`);
	const unknown = unknownField(rule, RULE_FIELDS);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const compiled = {
		name: requiredText(rule.name, source, `${label}.name`),
		fix: optionalText(rule.fix, source, `${label}.fix`) ?? "",
		report: optionalText(rule.report, source, `${label}.report`) ?? "",
		scope: compileScope(rule.scope, lists, source, `${label}.scope`),
		whenNoFindings: rule.whenNoFindings === true,
		bannedPath: rule.bannedPath === true,
		textIncludes: optionalText(rule.textIncludes, source, `${label}.textIncludes`) ?? "",
		textGate: compileTextGate(rule.textGate, source, `${label}.textGate`),
		imports: compileImports(rule.imports, lists, source, `${label}.imports`),
		walk: compileWalk(rule.walk, lists, source, `${label}.walk`),
		exportSurface: compileExportSurface(rule.exportSurface, lists, source, `${label}.exportSurface`),
		interfaceMember: compileInterfaceMember(rule.interfaceMember, source, `${label}.interfaceMember`),
		manifestImport: compileManifestImport(rule.manifestImport, lists, source, `${label}.manifestImport`),
		phases: Array.isArray(rule.phases)
			? rule.phases.map((phase, phaseIndex) => compilePhase(phase, lists, source, `${label}.phases[${phaseIndex}]`))
			: null,
	};
	const hasAction = [
		compiled.bannedPath,
		compiled.textIncludes,
		compiled.textGate,
		compiled.imports,
		compiled.walk,
		compiled.exportSurface,
		compiled.interfaceMember,
		compiled.manifestImport,
		compiled.phases,
	].some(Boolean);
	if (!hasAction) fail(source, `${label} does not check anything`);
	if (compiled.phases && (compiled.imports || compiled.walk || compiled.bannedPath || compiled.textIncludes)) {
		fail(source, `${label} phases replace the other checks`);
	}
	if ((compiled.bannedPath || compiled.textIncludes) && !compiled.report) {
		fail(source, `${label}.report is required`);
	}
	return compiled;
}

function compileManifestRule(rule, source, index) {
	const label = `manifests[${index}]`;
	if (!isPlainObject(rule)) fail(source, `${label} must be a mapping`);
	const allowed = new Set([
		"name",
		"whenName",
		"dependency",
		"groups",
		"dependencyWhere",
		"exports",
		"finding",
		"missingName",
		"fix",
	]);
	const unknown = unknownField(rule, allowed);
	if (unknown) fail(source, `${label} has unknown field "${unknown}"`);
	const compiled = {
		name: requiredText(rule.name, source, `${label}.name`),
		whenName: optionalText(rule.whenName, source, `${label}.whenName`) ?? "",
		dependency: optionalText(rule.dependency, source, `${label}.dependency`) ?? "",
		groups: optionalStringList(rule.groups, source, `${label}.groups`),
		finding: optionalText(rule.finding, source, `${label}.finding`) ?? "",
		missingName: optionalText(rule.missingName, source, `${label}.missingName`) ?? "workspace package",
		fix: optionalText(rule.fix, source, `${label}.fix`) ?? "",
		dependencyWhere: null,
		exports: null,
	};
	if (rule.dependencyWhere !== undefined) {
		if (!isPlainObject(rule.dependencyWhere)) fail(source, `${label}.dependencyWhere must be a mapping`);
		compiled.dependencyWhere = {
			prefix: optionalStringList(rule.dependencyWhere.prefix, source, `${label}.dependencyWhere.prefix`),
			exact: new Set(optionalStringList(rule.dependencyWhere.exact, source, `${label}.dependencyWhere.exact`)),
		};
	}
	if (rule.exports !== undefined) {
		compiled.exports = asList(rule.exports, source, `${label}.exports`).map((item, itemIndex) => {
			if (!isPlainObject(item)) fail(source, `${label}.exports[${itemIndex}] must be a mapping`);
			return {
				keys: optionalStringList(item.keys, source, `${label}.exports.keys`),
				prefix: optionalText(item.prefix, source, `${label}.exports.prefix`) ?? "",
				finding: requiredText(item.finding, source, `${label}.exports.finding`),
			};
		});
	}
	if (
		!compiled.dependency &&
		!compiled.finding &&
		!compiled.dependencyWhere &&
		!compiled.exports &&
		!compiled.whenName
	) {
		fail(source, `${label} does not check anything`);
	}
	return compiled;
}

function compileLists(value, source) {
	if (value === undefined) return {};
	if (!isPlainObject(value)) fail(source, "lists must be a mapping");
	const lists = {};
	for (const [name, items] of Object.entries(value)) {
		lists[name] = stringList(items, source, `lists.${name}`);
	}
	return lists;
}

function compileScan(value, source) {
	if (!isPlainObject(value)) fail(source, "scan must be a mapping");
	const unknown = unknownField(value, SCAN_FIELDS);
	if (unknown) fail(source, `scan has unknown field "${unknown}"`);
	return {
		roots: stringList(value.roots, source, "scan.roots"),
		entryPaths: optionalStringList(value.entryPaths, source, "scan.entryPaths"),
		skipContains: optionalStringList(value.skipContains, source, "scan.skipContains"),
	};
}

function validateDocument(value, source) {
	if (!isPlainObject(value)) fail(source, "rule document must be a mapping");
	const unknown = unknownField(value, DOCUMENT_FIELDS);
	if (unknown) fail(source, `unknown field "${unknown}"`);
	const lists = compileLists(value.lists, source);
	const rules = asList(value.rules, source, "rules").map((rule, index) => compileRule(rule, lists, source, index));
	const seen = new Set();
	for (const rule of rules) {
		if (seen.has(rule.name)) fail(source, `duplicate rule name ${rule.name}`);
		seen.add(rule.name);
	}
	const manifests = Array.isArray(value.manifests)
		? value.manifests.map((rule, index) => compileManifestRule(rule, source, index))
		: [];
	for (const rule of manifests) {
		if (seen.has(rule.name)) fail(source, `duplicate rule name ${rule.name}`);
		seen.add(rule.name);
	}
	const examples = Array.isArray(value.examples) ? value.examples : fail(source, "examples must be a list");
	return {
		name: requiredText(value.name, source, "name"),
		description: requiredText(value.description, source, "description"),
		rationale: requiredText(value.rationale, source, "rationale"),
		examples: examples.map((example, index) => {
			if (!isPlainObject(example)) fail(source, `examples[${index}] must be a mapping`);
			const extra = unknownField(example, EXAMPLE_FIELDS);
			if (extra) fail(source, `examples[${index}] has unknown field "${extra}"`);
			return {
				violation: requiredText(example.violation, source, `examples[${index}].violation`),
				fix: requiredText(example.fix, source, `examples[${index}].fix`),
			};
		}),
		scan: compileScan(value.scan, source),
		rules,
		manifests,
	};
}

function parseYaml(text, source) {
	const document = parseDocument(text);
	const problem = document.errors[0] ?? document.warnings[0];
	if (problem) fail(source, problem.message);
	try {
		return document.toJS();
	} catch (error) {
		fail(source, error instanceof Error ? error.message : String(error));
	}
}

/** Parse one package-boundary document. `sourceName` is included in errors. */
export function parseBoundaryDocument(text, sourceName = "<inline>") {
	return validateDocument(parseYaml(text, sourceName), sourceName);
}

/** Read and compile the package-boundary YAML. */
export function loadBoundaryDocument(filePath) {
	let text;
	try {
		text = readFileSync(filePath, "utf8");
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
		throw new BoundaryDocumentError(filePath, `unable to read rule file (${code})`);
	}
	return parseBoundaryDocument(text, filePath);
}

function render(template, vars) {
	return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] === undefined ? "" : String(vars[key])));
}

function formatKind(path) {
	if (path.startsWith("packages/coding-agent/src/sessions/external/")) return "External";
	if (path.startsWith("packages/coding-agent/src/sessions/legacy/")) return "Legacy";
	return "";
}

function emit(findings, file, line, rule, template, vars) {
	findings.push({
		file,
		line,
		rule: rule.name,
		message: render(template, vars),
		fix: rule.fix,
	});
}

function asLiteral(node) {
	if (!node || typeof node.text !== "string") return null;
	if (node.kind === "StringLiteral" || node.kind === "NoSubstitutionTemplateLiteral") {
		return { text: node.text, line: node.line };
	}
	return null;
}

function directLiteral(node) {
	return asLiteral(node) ?? (node.children ?? []).map(asLiteral).find(Boolean) ?? null;
}

function isRuntimeImport(node) {
	const clause = (node.children ?? []).find((child) => child.kind === "ImportClause");
	if (!clause) return true;
	if (clause.typeOnly) return false;
	const named = (clause.children ?? []).find((child) => child.kind === "NamedImports");
	const hasDefault = (clause.children ?? []).some((child) => child.kind === "Identifier");
	const hasNamespace = (clause.children ?? []).some((child) => child.kind === "NamespaceImport");
	if (hasDefault || hasNamespace || !named) return true;
	const specs = named.children ?? [];
	return specs.length === 0 || specs.some((specifier) => !specifier.typeOnly);
}

function isRuntimeExport(node) {
	if (node.typeOnly) return false;
	const named = (node.children ?? []).find((child) => child.kind === "NamedExports");
	if (!named) return true;
	const specs = named.children ?? [];
	return specs.length === 0 || specs.some((specifier) => !specifier.typeOnly);
}

function callSpecifier(node) {
	const children = node.children ?? [];
	const callee = children[0];
	const dynamic = callee?.kind === "ImportKeyword";
	const required = callee?.kind === "Identifier" && callee.text === "require";
	if (!dynamic && !required) return null;
	const args = children.slice(1);
	if (args.length !== 1) return null;
	return asLiteral(args[0]);
}

function collectSpecifiers(ast, runtimeOnly) {
	const found = [];
	walkAst(ast, (node) => {
		if (node.kind === "ImportDeclaration") {
			if (runtimeOnly && !isRuntimeImport(node)) return;
			const specifier = directLiteral(node);
			if (specifier) found.push(specifier);
			return;
		}
		if (node.kind === "ExportDeclaration") {
			if (runtimeOnly && !isRuntimeExport(node)) return;
			const specifier = directLiteral(node);
			if (specifier) found.push(specifier);
			return;
		}
		if (node.kind === "ImportEqualsDeclaration") {
			if (runtimeOnly && node.typeOnly) return;
			const external = (node.children ?? []).find((child) => child.kind === "ExternalModuleReference");
			const specifier = external ? directLiteral(external) : null;
			if (specifier) found.push(specifier);
			return;
		}
		if (node.kind === "CallExpression") {
			const specifier = callSpecifier(node);
			if (specifier) found.push(specifier);
		}
	});
	return found;
}

/** Import specifiers using the same edges as the legacy package-boundary checker. */
export function collectBoundaryImportSpecifiers(filePath, text) {
	return collectSpecifiers(parseSource(filePath, text), false).map((specifier) => specifier.text);
}

function whereMatches(where, specifier, path) {
	if (where.whereAny) return where.whereAny.some((item) => whereMatches(item, specifier, path));
	if (where.skipExact.has(specifier)) return false;
	if (where.skipWhenPrefix.some((prefix) => path.startsWith(prefix))) return false;
	const normalized = toPosix(specifier);
	const checks = [];
	if (where.appId) checks.push(appIdOf(normalized, where.appId) !== null);
	if (where.testTree) checks.push(TEST_TREE.test(normalized));
	if (where.prefix.length > 0) {
		checks.push(where.prefix.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)));
	}
	if (where.startsWith.length > 0) checks.push(where.startsWith.some((prefix) => normalized.startsWith(prefix)));
	if (where.includes.length > 0) checks.push(where.includes.some((fragment) => normalized.includes(fragment)));
	if (where.regex) checks.push(where.regex.test(normalized));
	if (where.exact.size > 0) checks.push(where.exact.has(normalized));
	return checks.length > 0 && checks.every(Boolean);
}

function appIdOf(specifier, appId) {
	for (const packageName of appId.packages) {
		if (specifier === packageName || specifier.startsWith(`${packageName}/`)) return packageName;
	}
	const match = specifier.match(appId.pattern);
	return match?.[1] ? `${match[1]} path` : null;
}

function runImports(imports, specifiers, runtimeSpecifiers, ctx) {
	const source = imports.runtime ? runtimeSpecifiers : specifiers;
	const matched = [];
	for (const specifier of source) {
		for (const clause of imports.clauses) {
			if (clause.unlessPaths.has(ctx.path)) continue;
			if (clause.whenText && !clause.whenText.test(ctx.text)) continue;
			if (!whereMatches(clause.where, specifier.text, ctx.path)) continue;
			const id = clause.where.appId ? appIdOf(toPosix(specifier.text), clause.where.appId) : "";
			matched.push({ clause, specifier, id });
			if (imports.once === "first" || imports.once === "any") break;
		}
		if ((imports.once === "first" || imports.once === "any") && matched.length > 0) break;
	}
	const emitted = imports.once === "any" ? matched.slice(0, 1) : matched;
	for (const hit of emitted) {
		emit(ctx.findings, ctx.path, hit.specifier.line, ctx.rule, hit.clause.report, {
			...ctx.vars,
			specifier: hit.specifier.text,
			id: hit.id ?? "",
		});
	}
}

function identifierName(node) {
	return node.kind === "Identifier" && typeof node.text === "string" ? node.text : null;
}

function lastIdentifier(node) {
	const names = (node.children ?? []).map(identifierName).filter(Boolean);
	return names.at(-1) ?? null;
}

function walkHit(item, node) {
	if (item.kind === "bucket") {
		for (const child of item.match) {
			const hit = walkHit(child, node);
			if (hit) return hit;
		}
		return null;
	}
	if (item.kind === "identifier") {
		const name = identifierName(node);
		return name && item.names.has(name) ? { name, line: node.line } : null;
	}
	if (item.kind === "literal" || item.kind === "literalPattern") {
		const literal = asLiteral(node);
		if (!literal) return null;
		const named = item.kind === "literal" && item.names.has(literal.text);
		const patterned = item.patterns.some((pattern) => pattern.test(literal.text));
		return named || patterned ? { name: literal.text, line: literal.line } : null;
	}
	if (item.kind === "propertyAccess") {
		if (node.kind !== "PropertyAccessExpression") return null;
		const children = node.children ?? [];
		const object = children[0];
		if (item.object && (object?.kind !== "Identifier" || object.text !== item.object)) return null;
		if (lastIdentifier(node) !== item.property) return null;
		return { name: item.property, line: node.line };
	}
	if (item.kind === "new" || item.kind === "call") {
		const expected = item.kind === "new" ? "NewExpression" : "CallExpression";
		if (node.kind !== expected) return null;
		const callee = node.children?.[0];
		if (callee?.kind !== "Identifier" || !item.names.has(callee.text)) return null;
		return { name: callee.text, line: callee.line };
	}
	if (item.kind === "propertyAssignment") {
		if (node.kind !== "PropertyAssignment") return null;
		const name = (node.children ?? []).map(identifierName).find(Boolean);
		if (!name || !item.names.has(name)) return null;
		if (item.initializer === false && !(node.children ?? []).some((child) => child.kind === "FalseKeyword")) {
			return null;
		}
		return { name, line: node.line };
	}
	if (item.kind === "accessChain") {
		if (node.kind !== "PropertyAccessExpression") return null;
		const property = lastIdentifier(node);
		if (!property || !item.chainNames.has(property)) return null;
		const inner = (node.children ?? []).find((child) => child.kind === "PropertyAccessExpression");
		if (!inner || lastIdentifier(inner) !== item.chainObject) return null;
		return { name: property, line: node.line };
	}
	if (item.kind === "declaration") {
		if (!item.declarationKinds.has(node.kind)) return null;
		const name = (node.children ?? []).map(identifierName).find(Boolean);
		if (!name || !item.names.has(name)) return null;
		return { name, line: node.line };
	}
	return null;
}

function runWalk(items, ast, ctx) {
	const buckets = items.map(() => []);
	const seen = items.map(() => new Set());
	walkAst(ast, (node) => {
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			const hit = walkHit(item, node);
			if (!hit) continue;
			if (item.once && seen[index].size > 0) continue;
			if (item.unique || item.kind === "bucket") {
				if (seen[index].has(hit.name)) continue;
				seen[index].add(hit.name);
				buckets[index].push(hit);
				continue;
			}
			seen[index].add(hit.name);
			emit(ctx.findings, ctx.path, hit.line, ctx.rule, item.report, { ...ctx.vars, name: hit.name });
		}
	});
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!item.unique && item.kind !== "bucket") continue;
		const hits = item.order === "listed" ? listedHits(item.listed, buckets[index]) : buckets[index];
		for (const hit of hits) {
			emit(ctx.findings, ctx.path, hit.line, ctx.rule, item.report, { ...ctx.vars, name: hit.name });
		}
	}
}

function listedHits(names, hits) {
	const byName = new Map(hits.map((hit) => [hit.name, hit]));
	return names.map((name) => byName.get(name)).filter(Boolean);
}

function runExportSurface(surface, ast, ctx) {
	for (const statement of ast.children ?? []) {
		if (statement.kind !== "ExportDeclaration") continue;
		const specifier = directLiteral(statement);
		const moduleName = specifier?.text ?? "";
		const moduleHit =
			surface.module.exact.has(moduleName) ||
			surface.module.prefix.some((prefix) => moduleName === prefix || moduleName.startsWith(`${prefix}/`)) ||
			surface.module.includes.some((fragment) => moduleName.includes(fragment));
		if (moduleName && moduleHit) {
			emit(ctx.findings, ctx.path, specifier.line, ctx.rule, surface.module.report, {
				...ctx.vars,
				specifier: moduleName,
			});
		}
		const named = (statement.children ?? []).find((child) => child.kind === "NamedExports");
		for (const element of named?.children ?? []) {
			const exported = [...(element.children ?? [])].reverse().map(identifierName).find(Boolean);
			if (!exported || !surface.names.has(exported)) continue;
			emit(ctx.findings, ctx.path, element.line, ctx.rule, surface.report, { ...ctx.vars, name: exported });
		}
	}
}

function typeText(node, text) {
	if (!node || typeof node.start !== "number" || typeof node.end !== "number") return "";
	return text.slice(node.start, node.end);
}

function runInterfaceMember(member, ast, text, ctx) {
	for (const statement of ast.children ?? []) {
		if (statement.kind !== "InterfaceDeclaration") continue;
		const name = (statement.children ?? []).map(identifierName).find(Boolean);
		if (name !== member.interfaceName) continue;
		for (const child of statement.children ?? []) {
			if (child.kind !== "PropertySignature") continue;
			const property = (child.children ?? []).map(identifierName).find(Boolean);
			if (property !== member.property) continue;
			const typeNode = [...(child.children ?? [])].reverse().find((item) => item.kind !== "Identifier");
			if (typeText(typeNode, text) === member.typeNot) continue;
			emit(ctx.findings, ctx.path, child.line, ctx.rule, member.report, ctx.vars);
		}
	}
}

function workspacePackageName(specifier, scopes) {
	if (!scopes.some((scope) => specifier.startsWith(scope))) return undefined;
	return specifier.split("/").slice(0, 2).join("/");
}

function runManifestImport(check, specifiers, ctx) {
	const manifest = ctx.manifest;
	if (!manifest || !check.packages.has(manifest.name)) return;
	const declared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	for (const specifier of specifiers) {
		const packageName = workspacePackageName(specifier.text, check.scopes);
		if (!packageName || packageName === manifest.name || declared.has(packageName)) continue;
		emit(ctx.findings, ctx.path, specifier.line, ctx.rule, check.report, {
			...ctx.vars,
			packageName,
			manifest: manifest.name,
			specifier: specifier.text,
		});
	}
}

function scanIdentifiers(ast) {
	const seen = new Set();
	const hits = [];
	walkAst(ast, (node) => {
		const name = identifierName(node);
		if (!name || seen.has(name)) return;
		seen.add(name);
		hits.push({ name, line: node.line });
	});
	return { seen, hits };
}

function reportPresent(present, bag, ctx) {
	if (!bag) return;
	const skipped = present.skip.find((item) => item.path === ctx.path);
	const selected =
		present.order === "listed"
			? present.listed.filter((name) => bag.seen.has(name)).map((name) => bag.hits.find((hit) => hit.name === name))
			: bag.hits.filter((hit) => present.names.has(hit.name));
	for (const hit of selected) {
		if (!hit || skipped?.names.has(hit.name)) continue;
		emit(ctx.findings, ctx.path, hit.line, ctx.rule, present.report, { ...ctx.vars, name: hit.name });
	}
}

function runPhases(phases, ast, specifiers, runtimeSpecifiers, ctx) {
	const bags = new Map();
	for (const phase of phases) {
		if (phase.stopWhen && pathInScope(phase.stopWhen, ctx.path)) return;
		if (phase.when && !pathInScope(phase.when, ctx.path)) continue;
		if (phase.scan) bags.set(phase.scan, scanIdentifiers(ast));
		if (phase.imports) runImports(phase.imports, specifiers, runtimeSpecifiers, ctx);
		if (phase.present) reportPresent(phase.present, bags.get(phase.present.id), ctx);
	}
}

function runTextIncludes(rule, ctx) {
	const index = ctx.text.indexOf(rule.textIncludes);
	if (index < 0) return;
	emit(ctx.findings, ctx.path, lineNumberAt(ctx.text, index), rule, rule.report, ctx.vars);
}

function runTextGate(gate, ctx) {
	if (!ctx.text.includes(gate.includes)) return;
	for (const check of gate.checks) {
		if (check.regex) {
			const match = check.regex.exec(ctx.text);
			if (!match) continue;
			emit(ctx.findings, ctx.path, lineNumberAt(ctx.text, match.index), ctx.rule, check.report, ctx.vars);
			continue;
		}
		if (!ctx.text.includes(check.missing)) {
			emit(ctx.findings, ctx.path, 1, ctx.rule, check.report, ctx.vars);
		}
	}
}

function applyRule(rule, ast, specifiers, runtimeSpecifiers, ctx) {
	if (rule.whenNoFindings && ctx.findings.length > 0) return;
	if (!pathInScope(rule.scope, ctx.path)) return;
	const local = { ...ctx, rule };
	if (rule.bannedPath) emit(local.findings, local.path, 1, rule, rule.report, local.vars);
	if (rule.textIncludes) runTextIncludes(rule, local);
	if (rule.textGate) runTextGate(rule.textGate, local);
	if (rule.imports) runImports(rule.imports, specifiers, runtimeSpecifiers, local);
	if (rule.walk) runWalk(rule.walk, ast, local);
	if (rule.exportSurface) runExportSurface(rule.exportSurface, ast, local);
	if (rule.interfaceMember) runInterfaceMember(rule.interfaceMember, ast, local.text, local);
	if (rule.manifestImport) runManifestImport(rule.manifestImport, specifiers, local);
	if (rule.phases) runPhases(rule.phases, ast, specifiers, runtimeSpecifiers, local);
}

/**
 * Findings for one file.
 * Each item is `{ file, line, rule, message, fix }`. `message` does not repeat the path.
 */
export function evaluateBoundaryFile(document, filePath, text, options = {}) {
	const path = toPosix(filePath);
	const ast = parseSource(path, text);
	const specifiers = collectSpecifiers(ast, false);
	const runtimeSpecifiers = collectSpecifiers(ast, true);
	const findings = [];
	const ctx = {
		path,
		text,
		findings,
		manifest: options.manifest,
		vars: { format: formatKind(path) },
	};
	for (const rule of document.rules) applyRule(rule, ast, specifiers, runtimeSpecifiers, ctx);
	return findings;
}

function manifestName(manifest, rule) {
	return manifest.name ?? rule.missingName;
}

function groupHas(manifest, groups, dependency) {
	return groups.some((group) => Object.hasOwn(manifest[group] ?? {}, dependency));
}

function productionDependencyNames(manifest, groups) {
	const merged = {};
	for (const group of groups) Object.assign(merged, manifest[group] ?? {});
	return Object.keys(merged);
}

function dependencySelected(name, where) {
	if (!where) return false;
	if (where.exact.has(name)) return true;
	return where.prefix.some((prefix) => name.startsWith(prefix));
}

function exportSelected(key, item) {
	if (item.keys.includes(key)) return true;
	if (!item.prefix) return false;
	return key === item.prefix || key.startsWith(`${item.prefix}/`);
}

function pushManifest(findings, rule, text) {
	findings.push({ name: rule.name, text, fix: rule.fix });
}

/** Manifest findings. `text` is the full legacy line. */
export function evaluateBoundaryManifest(document, manifest) {
	if (!manifest) return [];
	const findings = [];
	for (const rule of document.manifests) {
		if (rule.exports) {
			if (manifest.name !== rule.whenName) continue;
			const table = manifest.exports ?? {};
			for (const item of rule.exports) {
				const emitted = new Set();
				for (const key of item.keys) {
					if (!Object.hasOwn(table, key)) continue;
					emitted.add(key);
					pushManifest(findings, rule, render(item.finding, { key }));
				}
				if (!item.prefix) continue;
				for (const key of Object.keys(table)) {
					if (emitted.has(key) || !exportSelected(key, { ...item, keys: [] })) continue;
					pushManifest(findings, rule, render(item.finding, { key }));
				}
			}
			continue;
		}
		if (rule.dependencyWhere) {
			if (rule.whenName && manifest.name !== rule.whenName) continue;
			for (const dependency of productionDependencyNames(manifest, rule.groups)) {
				if (!dependencySelected(dependency, rule.dependencyWhere)) continue;
				pushManifest(findings, rule, render(rule.finding, { name: manifestName(manifest, rule), dependency }));
			}
			continue;
		}
		if (rule.dependency) {
			if (!groupHas(manifest, rule.groups, rule.dependency)) continue;
			pushManifest(
				findings,
				rule,
				render(rule.finding, { name: manifestName(manifest, rule), dependency: rule.dependency }),
			);
			continue;
		}
		if (rule.whenName && manifest.name === rule.whenName && rule.finding) pushManifest(findings, rule, rule.finding);
	}
	return findings;
}
