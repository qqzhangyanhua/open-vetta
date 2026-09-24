/**
 * Generate docs/dev/quality-gates-reference.md from guard JSDoc and YAML rules.
 *
 * Usage:
 *   bun run scripts/quality/generate-docs.mjs
 *   bun run scripts/quality/generate-docs.mjs --check
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseDocument } from "yaml";
import { isDirectRun, repoRoot } from "./lib.mjs";

export const referenceRelativePath = "docs/dev/quality-gates-reference.md";

const generatedWarning = "> 此文件自动生成，请勿手工编辑。";

export function extractGuardDoc(file, text) {
	const source = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
	const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
	if (!match) return { file, summary: "", detail: "" };
	const lines = match[1].split("\n").map(cleanJsdocLine);
	while (lines[0] === "") lines.shift();
	while (lines.at(-1) === "") lines.pop();
	const body = lines.join("\n");
	const splitAt = body.indexOf("\n\n");
	const summarySource = splitAt === -1 ? body : body.slice(0, splitAt);
	const detail = splitAt === -1 ? "" : body.slice(splitAt + 2).trim();
	return {
		file,
		summary: summarySource.replace(/\s*\n\s*/g, " ").trim(),
		detail,
	};
}

export function extractRuleDocument(file, text) {
	const value = parseYaml(text, file);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${file}: expected a mapping`);
	}
	const name = asString(value.name) || file.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
	return {
		file,
		name,
		description: asString(value.description),
		rationale: asString(value.rationale),
		docs: asStringList(value.docs),
		examples: extractExamples(value.examples),
		rules: extractRules(value),
	};
}

export function renderQualityGatesReference(model) {
	const lines = [
		generatedWarning,
		"",
		"源头是 `scripts/quality/check-*.mjs` 的文件头 JSDoc，以及 `scripts/quality/rules/*.yml`。",
		"重新生成：`bun run scripts/quality/generate-docs.mjs`。`bun run check:guards` 只核对这份文件，不改它；和源头不一致时该命令失败。",
		"",
		"# 质量门禁参考",
		"",
		"## 守卫",
		"",
	];
	for (const guard of model.guards) {
		lines.push(`### \`${guard.file}\``, "");
		if (guard.summary) lines.push(linkify(guard.summary, model), "");
		else lines.push("（源文件没有文件头 JSDoc）", "");
		if (guard.detail) lines.push(linkify(guard.detail, model), "");
	}
	lines.push("## 规则", "");
	for (const document of model.documents) {
		lines.push(`### ${document.name}`, "", `配置：\`${document.file}\``, "");
		if (document.description) lines.push("**描述**", "", linkify(document.description, model), "");
		if (document.rationale) lines.push("**理由**", "", linkify(document.rationale, model), "");
		pushDocList(lines, document.docs, model);
		if (document.examples.length > 0) {
			lines.push("**示例**", "");
			for (const example of document.examples) {
				if (example.violation) lines.push("违规：", "", fence(example.violation), "");
				if (example.fix) lines.push("修复：", "", fence(example.fix), "");
			}
		}
		if (document.rules.length === 0) continue;
		lines.push("**规则**", "");
		for (const rule of document.rules) {
			lines.push(`#### \`${rule.name}\``, "");
			if (rule.description) lines.push(linkify(rule.description, model), "");
			if (rule.type) lines.push(`类型：${rule.type}`, "");
			pushDocList(lines, rule.docs, model);
			if (rule.fix) lines.push(`修复建议：${inline(rule.fix)}`, "");
			if (rule.reports.length > 0) {
				lines.push("检查：", "");
				for (const report of rule.reports) lines.push(`- ${inline(report)}`);
				lines.push("");
			}
		}
	}
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}

export function loadQualityGatesSources(root = repoRoot) {
	const guardDirectory = join(root, "scripts/quality");
	const guards = readdirSync(guardDirectory)
		.filter((name) => name.startsWith("check-") && name.endsWith(".mjs") && !name.endsWith(".legacy.mjs"))
		.sort()
		.map((name) => {
			const file = `scripts/quality/${name}`;
			return extractGuardDoc(file, readFileSync(join(root, file), "utf8"));
		});
	const ruleDirectory = join(root, "scripts/quality/rules");
	const documents = readdirSync(ruleDirectory)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.sort()
		.map((name) => {
			const file = `scripts/quality/rules/${name}`;
			return extractRuleDocument(file, readFileSync(join(root, file), "utf8"));
		});
	return { guards, documents, adrPaths: indexAdrPaths(root), root };
}

export function syncQualityGatesReference({ root = repoRoot, check = false, sources } = {}) {
	const next = renderQualityGatesReference(sources ?? loadQualityGatesSources(root));
	const target = join(root, referenceRelativePath);
	const current = existsSync(target) ? readFileSync(target, "utf8") : "";
	const changed = current !== next;
	if (!check && changed) {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, next);
	}
	return { changed, path: referenceRelativePath };
}

const staleReferenceMessage =
	"[generate-docs] docs/dev/quality-gates-reference.md is stale. Run: bun run scripts/quality/generate-docs.mjs";

export function referenceStatus(result, { check = false } = {}) {
	if (result.changed && check) return { error: true, line: staleReferenceMessage };
	if (result.changed) return { error: false, line: "[generate-docs] wrote docs/dev/quality-gates-reference.md" };
	return { error: false, line: "[generate-docs] docs/dev/quality-gates-reference.md is up to date" };
}

export function main(argv = process.argv.slice(2)) {
	const check = argv.includes("--check");
	const status = referenceStatus(syncQualityGatesReference({ check }), { check });
	if (status.error) {
		console.error(status.line);
		return 1;
	}
	console.log(status.line);
	return 0;
}

function cleanJsdocLine(line) {
	const starred = line.match(/^\s*\*\s?(.*)$/);
	if (starred) return starred[1].replace(/\s+$/, "");
	return line.trim();
}

function parseYaml(text, source) {
	const document = parseDocument(text);
	const problem = document.errors[0];
	if (problem) throw new Error(`${source}: ${problem.message}`);
	try {
		return document.toJS();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${source}: ${message}`);
	}
}

function asString(value) {
	return typeof value === "string" ? value.trim() : "";
}

function asStringList(value) {
	if (typeof value === "string" && value.trim()) return [value.trim()];
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function extractExamples(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item) => item && typeof item === "object")
		.map((item) => ({ violation: asString(item.violation), fix: asString(item.fix) }))
		.filter((item) => item.violation || item.fix);
}

function extractRules(value) {
	const entries = [...ruleEntries(value.rules), ...ruleEntries(value.guards)];
	return entries.filter((rule) => rule.name);
}

function ruleEntries(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item) => item && typeof item === "object")
		.map((item) => ({
			name: asString(item.name),
			description: asString(item.description) || asString(item.summary),
			type: asString(item.type),
			fix: asString(item.fix),
			docs: [...asStringList(item.doc), ...asStringList(item.docs)],
			reports: collectReports(item),
		}));
}

function isMessageKey(key) {
	return (
		key === "report" ||
		key === "message" ||
		key === "missingFile" ||
		key === "missingMarker" ||
		key.endsWith("Report")
	);
}

function collectReports(node) {
	const reports = [];
	const seen = new Set();
	visit(node);
	return reports;

	function pushReport(text) {
		const message = text.trim();
		if (!message || seen.has(message)) return;
		seen.add(message);
		reports.push(message);
	}

	function visit(value) {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		if (typeof value.label === "string" && typeof value.source === "string") pushReport(value.label);
		for (const [key, child] of Object.entries(value)) {
			if (isMessageKey(key) && typeof child === "string") {
				pushReport(child);
				continue;
			}
			visit(child);
		}
	}
}

function indexAdrPaths(root) {
	const directory = join(root, "docs/adr");
	const paths = new Map();
	if (!existsSync(directory)) return paths;
	for (const name of readdirSync(directory).sort()) {
		const match = /^(\d+)-.*\.md$/.exec(name);
		if (!match) continue;
		paths.set(match[1].padStart(4, "0"), `docs/adr/${name}`);
	}
	return paths;
}

function linkify(text, model) {
	return text.replace(/(?<!\[)\bADR-\d+\b/g, (token) => {
		const href = hrefFor(token, model);
		return href ? `[${token}](${href})` : token;
	});
}

function pushDocList(lines, docs, model) {
	if (docs.length === 0) return;
	lines.push("**相关文档**", "");
	for (const token of docs) {
		const href = hrefFor(token, model);
		lines.push(href ? `- [${token}](${href})` : `- ${token}`);
	}
	lines.push("");
}

function hrefFor(token, model) {
	const adr = /^ADR-(\d+)$/.exec(token);
	if (adr) {
		const path = model.adrPaths?.get(adr[1].padStart(4, "0"));
		return path ? toHref(path) : undefined;
	}
	if (!/^(?:docs|packages|apps)\/[^\n]+$/.test(token) || token.includes("..")) return undefined;
	if (model.root && !existsSync(join(model.root, token))) return undefined;
	return toHref(token);
}

function toHref(repoPath) {
	const href = relative("docs/dev", repoPath).replaceAll("\\", "/");
	return href.startsWith(".") ? href : `./${href}`;
}

function inline(text) {
	return text.replace(/\s+/g, " ").trim();
}

function fence(text) {
	const body = text.replaceAll("\r\n", "\n").replace(/\n$/, "");
	let ticks = "```";
	while (body.includes(ticks)) ticks += "`";
	return `${ticks}\n${body}\n${ticks}`;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
