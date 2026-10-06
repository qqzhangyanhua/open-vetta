/**
 * Architecture engine only: package boundaries and Coding Agent architecture.
 * The other guards stay on `bun run check:guards` / `bun run check`.
 *
 * Usage:
 *   bun run check:arch
 */

import { isDirectRun, runBunParallel } from "./lib.mjs";

export function createArchitectureCheckPlan() {
	return [
		["run", "scripts/quality/check-package-boundaries.mjs"],
		["run", "scripts/quality/check-coding-agent-architecture.mjs"],
	];
}

export function main() {
	return runBunParallel(createArchitectureCheckPlan());
}

if (isDirectRun(import.meta.url)) {
	main().then((code) => {
		process.exit(code);
	});
}
