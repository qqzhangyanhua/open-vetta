/**
 * Run all independent always-on quality guards in parallel (used by `bun run check`).
 * After those guards finish, rewrite the quality-gates reference from the guard
 * JSDoc and YAML rules. CI only compares the committed file and fails when it is stale.
 */

import { referenceStatus, syncQualityGatesReference } from "./generate-docs.mjs";
import { isDirectRun, runBunParallel } from "./lib.mjs";

/** GitHub Actions and most CI systems set `CI=true`. Local checks leave it unset. */
export function referenceCheckOnly(env = process.env) {
	const value = env.CI;
	return value === "true" || value === "1";
}

export function createGuardCheckPlan() {
	return [
		["run", "packages/capability-sdk/scripts/generate-catalog.ts", "--check"],
		["run", "packages/coding-agent/scripts/generate-personas.mjs", "--check"],
		["run", "packages/coding-agent/scripts/generate-themes.mjs", "--check"],
		["run", "apps/desktop/scripts/build-agent-modes.mjs", "--check"],
		["run", "scripts/quality/check-private-keys.mjs"],
		["run", "scripts/quality/check-conflict-markers.mjs"],
		// Rules: scripts/quality/rules/package-boundaries.yml
		["run", "scripts/quality/check-package-boundaries.mjs"],
		// Rules: scripts/quality/rules/coding-agent-architecture.yml
		["run", "scripts/quality/check-coding-agent-architecture.mjs"],
		// Rules: scripts/quality/rules/runtime-boundaries.yml
		["run", "scripts/quality/check-runtime-boundaries.mjs"],
		["run", "scripts/quality/check-conversation-message-architecture.mjs"],
		["run", "scripts/quality/check-agent-ai-maintainability.mjs"],
		["run", "scripts/quality/check-standalone-cli-build.mjs"],
		["run", "scripts/quality/check-skill-frontmatter.mjs"],
		["run", "scripts/quality/check-vitest-runner.mjs"],
		["run", "scripts/quality/check-source-path-maps.mjs"],
		["run", "scripts/quality/check-turbo-config.mjs"],
	];
}

export async function main({
	run = runBunParallel,
	sync,
	root,
	sources,
	log = console.log,
	error = console.error,
	check = referenceCheckOnly(),
} = {}) {
	const guardCode = await run(createGuardCheckPlan());
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
	return guardCode !== 0 ? guardCode : docCode;
}

if (isDirectRun(import.meta.url)) {
	main().then((code) => {
		process.exit(code);
	});
}
