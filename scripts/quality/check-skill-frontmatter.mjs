/**
 * Guard SKILL.md frontmatter against the mistakes that make a skill vanish.
 *
 * Why a guard and not just care: frontmatter is parsed with a real YAML parser
 * (packages/coding-agent/src/resources/shared/frontmatter.ts). When it throws, nothing the
 * author can see reports it — the loader drops the skill, and it silently
 * disappears from the agent's skill list and the slash menu. The description is
 * long prose written by hand, so the usual break is plain YAML syntax: an
 * unquoted scalar containing ": " parses as a nested mapping and errors out.
 *
 * This does NOT re-implement YAML (guards stay dependency-free, see lib.mjs).
 * It checks the shape skills actually use — a flat block of `key: value` — and
 * rejects the unquoted-scalar hazards plus a missing/oversized description.
 *
 * Usage:
 *   bun run scripts/quality/check-skill-frontmatter.mjs
 *   bun run scripts/quality/check-skill-frontmatter.mjs --staged
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	CheckViolation,
	collectFileViolations,
	isDirectRun,
	readText,
	rel,
	repoRoot,
	runCheck,
	stagedFiles,
} from "./lib.mjs";

/** Mirrors MAX_DESCRIPTION_LENGTH in packages/coding-agent/src/core/skills.ts. */
const MAX_DESCRIPTION_LENGTH = 1024;

const SCAN_ROOTS = ["packages", "apps", ".claude"];
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	".git",
	"release",
	"releases",
	"coverage",
	"out",
	"build",
	".turbo",
	".cache",
	// Build staging copies of system plugins — the sources are scanned already,
	// and a stale copy here would report the same file twice.
	".artifacts",
	// The loader's own tests need deliberately broken frontmatter to assert on.
	"fixtures",
]);

function findSkillFiles(dir, results = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			findSkillFiles(join(dir, entry.name), results);
			continue;
		}
		if (entry.name === "SKILL.md") results.push(join(dir, entry.name));
	}
	return results;
}

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return stagedFiles().filter((file) => file.endsWith("SKILL.md") && existsSync(join(repoRoot, file)));
	}
	const results = [];
	for (const root of SCAN_ROOTS) findSkillFiles(join(repoRoot, root), results);
	return results.map((file) => rel(file));
}

/** Same extraction as packages/coding-agent/src/resources/shared/frontmatter.ts. */
function frontmatterOf(text) {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return null;
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return null;
	return normalized.slice(4, end);
}

function isQuoted(value) {
	return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

/** `description: >` / `|-` … — the value is the indented block that follows. */
function isBlockScalar(value) {
	return /^[|>][+-]?\d*$/.test(value);
}

/** Unquoted plain scalars where YAML would choke or silently truncate. */
function scalarHazard(value) {
	if (value.includes(": ")) return 'contains ": " — YAML reads it as a nested mapping and fails to parse';
	if (value.endsWith(":")) return 'ends with ":" — YAML reads it as a nested mapping and fails to parse';
	if (/\s#/.test(value)) return 'contains " #" — YAML truncates the rest as a comment';
	if (/^[[{*&!%@`]/.test(value)) return `starts with "${value[0]}" — reserved YAML indicator`;
	return null;
}

function legacyMessageIncludesLine(problem) {
	return problem.rule === "frontmatter-entry" || problem.rule === "unquoted-scalar";
}

/** Structured frontmatter findings. `line` is 1-based in the original file. */
function analyzeSkillFrontmatter(text) {
	const problems = [];
	const yamlString = frontmatterOf(text);
	if (yamlString === null) {
		return [
			{
				line: 1,
				rule: "frontmatter-block",
				message: "missing or unterminated --- frontmatter block",
			},
		];
	}

	const values = new Map();
	let descriptionLine = 1;
	const lines = yamlString.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const lineNumber = index + 2;
		// Only top-level `key: value` lines are validated; indented blocks,
		// list items, comments and blanks are left to the real parser.
		if (line.trim() === "" || line.startsWith("#") || /^\s/.test(line) || line.startsWith("-")) continue;
		const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!match) {
			problems.push({
				line: lineNumber,
				rule: "frontmatter-entry",
				message: `not a \`key: value\` entry — ${JSON.stringify(line.slice(0, 60))}`,
			});
			continue;
		}
		const [, key, rawValue] = match;
		const value = rawValue.trim();
		if (key === "description") descriptionLine = lineNumber;
		if (isBlockScalar(value)) {
			// Folded/literal block: the value is every indented line below it.
			const block = [];
			while (index + 1 < lines.length && (lines[index + 1].trim() === "" || /^\s/.test(lines[index + 1]))) {
				index += 1;
				block.push(lines[index].trim());
			}
			values.set(key, block.join(" ").trim());
			continue;
		}
		if (isQuoted(value)) {
			values.set(key, value.slice(1, -1));
			continue;
		}
		values.set(key, value);
		if (value === "") continue;
		const hazard = scalarHazard(value);
		if (hazard) {
			problems.push({
				line: lineNumber,
				rule: "unquoted-scalar",
				message: `\`${key}\` ${hazard} (wrap the value in double quotes)`,
			});
		}
	}

	const description = values.get("description");
	if (description === undefined || description === "") {
		problems.push({
			line: descriptionLine,
			rule: "description-required",
			message: "description is required — it is the only text the model sees before invoking the skill",
		});
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		problems.push({
			line: descriptionLine,
			rule: "description-length",
			message: `description is ${description.length} chars (max ${MAX_DESCRIPTION_LENGTH})`,
		});
	}
	return problems;
}

/** Human-readable problems with one SKILL.md's frontmatter; empty = fine. */
export function findSkillFrontmatterProblems(text) {
	return analyzeSkillFrontmatter(text).map((problem) =>
		legacyMessageIncludesLine(problem) ? `line ${problem.line}: ${problem.message}` : problem.message,
	);
}

/** Same findings as {@link findSkillFrontmatterProblems}, as guard violations. */
export function findSkillFrontmatterViolations(file, text) {
	return analyzeSkillFrontmatter(text).map(
		(problem) => new CheckViolation(file, problem.line, problem.rule, problem.message),
	);
}

/** Read each repo-relative path and return frontmatter violations. A file that cannot be read is skipped. */
export function checkSkillFrontmatter(files, readFile = (file) => readText(join(repoRoot, file))) {
	return collectFileViolations(files, findSkillFrontmatterViolations, readFile);
}

export function main(argv = process.argv) {
	const stagedOnly = argv.includes("--staged");
	return runCheck("skill-frontmatter", () => checkSkillFrontmatter(collectTargets(stagedOnly)));
}

if (isDirectRun(import.meta.url)) {
	process.exitCode = main();
}
