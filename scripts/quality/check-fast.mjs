/**
 * One-second feedback for files already in the index.
 *
 * Private keys, conflict markers, and Biome all look at the staged set.
 * Biome does not rewrite: this command reports problems. Formatting stays
 * in `check:staged` and `check:precommit`.
 *
 * Usage:
 *   bun run check:fast
 */

import { isDirectRun, runBunParallel } from "./lib.mjs";

export function createFastCheckPlan() {
	return [
		["run", "scripts/quality/check-private-keys.mjs", "--staged"],
		["run", "scripts/quality/check-conflict-markers.mjs", "--staged"],
		["x", "@biomejs/biome", "check", "--error-on-warnings", "--staged", "--no-errors-on-unmatched"],
	];
}

export function main() {
	return runBunParallel(createFastCheckPlan());
}

if (isDirectRun(import.meta.url)) {
	main().then((code) => {
		process.exit(code);
	});
}
