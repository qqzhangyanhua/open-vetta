/**
 * Run all independent always-on quality guards in parallel (used by `bun run check`).
 */

import { runBunParallel } from "./lib.mjs";

const steps = [
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

process.exit(await runBunParallel(steps));
