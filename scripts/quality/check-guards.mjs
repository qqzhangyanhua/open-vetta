/** Run repository guards in full mode or select the guards affected by task files. */

import { spawn } from "node:child_process";
import { referenceStatus, syncQualityGatesReference } from "./generate-docs.mjs";
import { isDirectRun, repoRoot } from "./lib.mjs";

const FULL_STEPS = Object.freeze([
	["capability-catalog", "packages/capability-sdk/scripts/generate-catalog.ts", "--check"],
	["personas", "packages/coding-agent/scripts/generate-personas.mjs", "--check"],
	["themes", "packages/coding-agent/scripts/generate-themes.mjs", "--check"],
	["agent-modes", "apps/desktop/scripts/build-agent-modes.mjs", "--check"],
	["private-keys", "scripts/quality/check-private-keys.mjs"],
	["conflict-markers", "scripts/quality/check-conflict-markers.mjs"],
	["package-boundaries", "scripts/quality/check-package-boundaries.mjs"],
	["coding-agent-architecture", "scripts/quality/check-coding-agent-architecture.mjs"],
	["runtime-boundaries", "scripts/quality/check-runtime-boundaries.mjs"],
	["conversation-architecture", "scripts/quality/check-conversation-message-architecture.mjs"],
	["session-event-tombstones", "scripts/quality/check-session-event-tombstones.mjs"],
	["agent-ai-maintainability", "scripts/quality/check-agent-ai-maintainability.mjs"],
	["standalone-cli-build", "scripts/quality/check-standalone-cli-build.mjs"],
	["skill-frontmatter", "scripts/quality/check-skill-frontmatter.mjs"],
	["vitest-runner", "scripts/quality/check-vitest-runner.mjs"],
	["source-path-maps", "scripts/quality/check-source-path-maps.mjs"],
	["turbo-config", "scripts/quality/check-turbo-config.mjs"],
]);

const MAX_SELECTED_ARGUMENT_CHARS = 12_000;

function normalizeFiles(files) {
	return [...new Set(files.map((file) => file.replaceAll("\\", "/")))].sort();
}

function batches(files) {
	const result = [];
	let batch = [];
	let chars = 0;
	for (const file of files) {
		const next = file.length + 3;
		if (batch.length > 0 && chars + next > MAX_SELECTED_ARGUMENT_CHARS) {
			result.push(batch);
			batch = [];
			chars = 0;
		}
		batch.push(file);
		chars += next;
	}
	if (batch.length > 0) result.push(batch);
	return result;
}

function selectedSteps(id, script, files) {
	return batches(files).map((batch, index) => [`${id}${index === 0 ? "" : `-${index + 1}`}`, script, ...batch]);
}

function matchesAny(files, patterns) {
	return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

export function createQuickGuardPlan(inputFiles) {
	const files = normalizeFiles(inputFiles);
	if (files.length === 0) return [];
	const steps = [
		...selectedSteps("private-keys", "scripts/quality/check-private-keys.mjs", files),
		...selectedSteps("conflict-markers", "scripts/quality/check-conflict-markers.mjs", files),
	];
	const add = (id) => {
		const step = FULL_STEPS.find(([candidate]) => candidate === id);
		if (step) steps.push([...step]);
	};

	const boundaryFiles = files.filter(
		(file) => file === "tsconfig.json" || /^(?:apps|packages)\/.+\.(?:[cm]?[jt]sx?|json)$/u.test(file),
	);
	if (boundaryFiles.length > 0) {
		steps.push(...selectedSteps("package-boundaries", "scripts/quality/check-package-boundaries.mjs", boundaryFiles));
	}
	const sourceFiles = files.filter((file) => /^(?:apps|packages)\/.+\.(?:[cm]?[jt]sx?|swift|kt)$/u.test(file));
	if (sourceFiles.length > 0) {
		steps.push(
			...selectedSteps(
				"session-event-tombstones",
				"scripts/quality/check-session-event-tombstones.mjs",
				sourceFiles,
			),
		);
	}
	if (
		matchesAny(files, [
			/^packages\/coding-agent\//u,
			/^apps\/cli-host\//u,
			/^packages\/(?:agent|runtime-[^/]+)\//u,
			/^apps\/desktop\/src\/main\/(?:agent-runtime|conversations|knowledge)\//u,
		])
	) {
		add("coding-agent-architecture");
	}
	if (matchesAny(files, [/^packages\/capability-sdk\//u])) add("capability-catalog");
	if (matchesAny(files, [/^packages\/coding-agent\/(?:src|resources|scripts)\//u])) {
		add("personas");
		add("themes");
	}
	if (matchesAny(files, [/^apps\/desktop\/(?:src\/main\/agent-modes|scripts\/build-agent-modes\.mjs)/u])) {
		add("agent-modes");
	}
	if (
		matchesAny(files, [
			/^packages\/runtime-(?:core|knowledge|mcp|storage|subagents|telemetry|tools)\//u,
			/^packages\/coding-agent\/src\/(?:rpc|composition)\//u,
			/^packages\/(?:runtime-core|runtime-desktop)\/src\//u,
			/^apps\/(?:cli-host\/src|desktop\/src\/main|im-gateway\/internal)\//u,
		])
	) {
		add("runtime-boundaries");
	}
	if (
		matchesAny(files, [
			/^apps\/desktop\/src\/main\/agent-teams\//u,
			/^apps\/desktop\/src\/renderer\//u,
			/^packages\/agent-team\//u,
		])
	) {
		add("conversation-architecture");
	}
	if (matchesAny(files, [/^packages\/(?:agent|ai)\//u])) add("agent-ai-maintainability");
	if (
		matchesAny(files, [
			/^apps\/cli-host\//u,
			/^apps\/desktop\/(?:scripts|src\/main)\//u,
			/^scripts\/build-binaries\.sh$/u,
		])
	) {
		add("standalone-cli-build");
	}
	if (files.some((file) => file.endsWith("SKILL.md"))) add("skill-frontmatter");
	if (files.some((file) => file.endsWith("package.json"))) add("vitest-runner");
	if (files.some((file) => file.endsWith("package.json") || /(?:^|\/)tsconfig[^/]*\.json$/u.test(file))) {
		add("source-path-maps");
	}
	if (
		matchesAny(files, [
			/^(?:package\.json|turbo\.json|vercel\.json)$/u,
			/^apps\/docs-site\/(?:package\.json|vercel\.json)$/u,
			/^packages\/plugins\/presets\/plugin-workbench\/package\.json$/u,
		])
	) {
		add("turbo-config");
	}
	return steps;
}

export function fullGuardPlan() {
	return FULL_STEPS.map((step) => [...step]);
}

/** Full guard list. The name is the one `generate-docs` tests already call. */
export function createGuardCheckPlan() {
	return fullGuardPlan();
}

function runStep([, ...args]) {
	return new Promise((resolve) => {
		const child = spawn("bun", ["run", ...args], {
			cwd: repoRoot,
			stdio: "inherit",
			shell: false,
		});
		child.once("error", () => resolve(1));
		child.once("exit", (code) => resolve(code ?? 1));
	});
}

export async function runGuardPlan(steps) {
	if (steps.length === 0) return 0;
	const results = await Promise.all(steps.map(runStep));
	return results.find((code) => code !== 0) ?? 0;
}

/** GitHub Actions and most CI systems set `CI=true`. Local checks leave it unset. */
export function referenceCheckOnly(env = process.env) {
	const value = env.CI;
	return value === "true" || value === "1";
}

function isGuardOptions(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function finishReference({ sync, root, sources, log, error, check }) {
	let docCode = 0;
	try {
		const result = (sync ?? (() => syncQualityGatesReference({ root, sources, check })))();
		const status = referenceStatus(result, { check });
		if (status.error) {
			error(status.line);
			docCode = 1;
		} else {
			log(status.line);
		}
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		error(`[generate-docs] internal error: ${message}`);
		docCode = 1;
	}
	return docCode;
}

/**
 * CLI passes an argv array (`--quick` selects guards and does not rewrite docs).
 * `generate-docs` tests pass `{ run, root, sources, check, log, error }` and
 * the injected `run` replaces the real guard processes.
 */
export async function main(args = process.argv.slice(2)) {
	if (isGuardOptions(args)) {
		const {
			run = (steps) => runGuardPlan(steps),
			sync,
			root,
			sources,
			log = console.log,
			error = console.error,
			check = referenceCheckOnly(),
		} = args;
		const guardCode = await run(createGuardCheckPlan());
		const docCode = await finishReference({ sync, root, sources, log, error, check });
		return guardCode !== 0 ? guardCode : docCode;
	}

	const quick = args[0] === "--quick";
	const plan = quick ? createQuickGuardPlan(args.slice(1)) : fullGuardPlan();
	if (quick) {
		console.log(`[check:guards] quick plan: ${plan.map(([id]) => id).join(", ") || "(none)"}`);
		return runGuardPlan(plan);
	}
	const guardCode = await runGuardPlan(plan);
	const docCode = await finishReference({
		log: console.log,
		error: console.error,
		check: referenceCheckOnly(),
	});
	return guardCode !== 0 ? guardCode : docCode;
}

if (isDirectRun(import.meta.url)) {
	process.exit(await main());
}
