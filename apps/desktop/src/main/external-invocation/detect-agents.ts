import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import {
	type ExternalAgentAdapter,
	type ExternalAgentId,
	type ExternalAgentProcessForm,
	externalAgentAdapters,
} from "./grok-adapter.js";

export interface DetectedExternalAgent {
	readonly id: ExternalAgentId;
	readonly label: string;
	readonly executable: string;
	readonly processForm: ExternalAgentProcessForm;
}

const MARKER = "__VETTA_EXTERNAL_AGENT_PATH__";

export function detectExternalAgentsOnPath(
	pathValue: string,
	canExecute: (candidate: string) => boolean,
): readonly DetectedExternalAgent[] {
	const directories = pathValue.split(delimiter).filter((directory) => directory.length > 0);
	return externalAgentAdapters
		.filter((adapter) =>
			detectNames(adapter).some((name) => directories.some((directory) => canExecute(join(directory, name)))),
		)
		.map((adapter) => ({
			id: adapter.id,
			label: adapter.label,
			executable: adapter.executable,
			processForm: adapter.processForm,
		}));
}

function detectNames(adapter: ExternalAgentAdapter): readonly string[] {
	const names = [adapter.executable, ...(adapter.detectCmdAliases ?? [])];
	if (process.platform !== "win32") return names;
	return names.flatMap((name) => [`${name}.exe`, `${name}.cmd`, name]);
}

/** 读登录 shell 的 PATH。探测失败时返回空串，调用方就只剩 penguin。 */
export function readLoginShellPath(env: NodeJS.ProcessEnv = process.env): string {
	if (process.platform === "win32") return env.PATH ?? env.Path ?? "";
	const shell = env.SHELL || "/bin/zsh";
	try {
		const res = spawnSync(shell, ["-ilc", `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`], {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (res.status !== 0 || !res.stdout) return "";
		const start = res.stdout.indexOf(MARKER);
		const end = res.stdout.indexOf(MARKER, start + MARKER.length);
		if (start === -1 || end === -1) return "";
		return res.stdout.slice(start + MARKER.length, end).trim();
	} catch {
		return "";
	}
}
