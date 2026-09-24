import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { grokAdapter } from "./grok-adapter.js";

export interface DetectedExternalAgent {
	readonly id: "grok";
	readonly label: "Grok";
	readonly executable: "grok";
}

const MARKER = "__VETTA_EXTERNAL_AGENT_PATH__";

export function detectExternalAgentsOnPath(
	pathValue: string,
	canExecute: (candidate: string) => boolean,
): readonly DetectedExternalAgent[] {
	const names = process.platform === "win32" ? ["grok.exe", "grok.cmd", "grok"] : ["grok"];
	for (const directory of pathValue.split(delimiter)) {
		if (!directory) continue;
		for (const name of names) {
			if (canExecute(join(directory, name))) {
				return [{ id: grokAdapter.id, label: grokAdapter.label, executable: grokAdapter.executable }];
			}
		}
	}
	return [];
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
