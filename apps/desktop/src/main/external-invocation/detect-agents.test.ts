import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectExternalAgentsOnPath } from "./detect-agents.js";

describe("detectExternalAgentsOnPath", () => {
	it("lists only the CLIs whose command is on PATH", () => {
		const pathValue = ["/usr/bin", "/opt/bin"].join(delimiter);
		const present = new Set([
			join("/usr/bin", "omp"),
			join("/opt/bin", "codex"),
			join("/opt/bin", "pi"),
			join("/opt/bin", "droid"),
			join("/usr/bin", "opencode"),
		]);
		expect(
			detectExternalAgentsOnPath(pathValue, (candidate) => present.has(candidate)).map((agent) => ({
				id: agent.id,
				executable: agent.executable,
				processForm: agent.processForm,
			})),
		).toEqual([
			{ id: "omp", executable: "omp", processForm: "one-shot" },
			{ id: "codex", executable: "codex", processForm: "interactive" },
			{ id: "pi", executable: "pi", processForm: "interactive" },
			{ id: "droid", executable: "droid", processForm: "interactive" },
			{ id: "opencode", executable: "opencode", processForm: "interactive" },
		]);
	});

	it("hides every agent when none of the detectCmds are executable", () => {
		expect(detectExternalAgentsOnPath(["/usr/bin"].join(delimiter), () => false)).toEqual([]);
	});
});
