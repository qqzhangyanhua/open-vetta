import { locateCursorAgentSessionId, locateOmpSessionId } from "../external-sessions/external-agent-session-id.js";
import { locateGrokSessionId } from "../external-sessions/grok-session-locator.js";

/** 确认、信任和跳过权限都留给对方自己的终端询问，适配器不代传这些参数。 */
const GROK_SKIP_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"] as const;
const OMP_SKIP_FLAGS = ["--auto-approve", "--approval-mode", "--plan-yolo"] as const;
const CURSOR_SKIP_FLAGS = ["--force", "-f", "--yolo", "--trust", "--approve-mcps"] as const;

export type ExternalAgentId = "grok" | "omp" | "cursor-agent" | "agy" | "codex" | "pi" | "droid" | "opencode";

/** one-shot: 跑完即退出。interactive: 对方 TUI 一直开着，后续对话打在终端里。 */
export type ExternalAgentProcessForm = "one-shot" | "interactive";

/** Orca promptInjectionMode 的启动侧子集：空 prompt 时不带参数，只起 TUI。 */
type InteractivePromptMode = "argv" | "argv-dashdash" | "flag-prompt" | "flag-prompt-interactive";

export interface ExternalAgentAdapter {
	readonly id: ExternalAgentId;
	readonly label: string;
	/** PATH 上的命令名，可以和 id 不同（Orca 的 detectCmd）。 */
	readonly executable: string;
	readonly detectCmdAliases?: readonly string[];
	readonly processForm: ExternalAgentProcessForm;
	singleInstructionArgs(prompt: string, referencedPaths?: readonly string[]): readonly string[];
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths?: readonly string[]): readonly string[];
	locateSessionId(input: { sessionsRoot: string; cwd: string; startedAt: number }): string | null;
}

export const grokAdapter: ExternalAgentAdapter = {
	id: "grok",
	label: "Grok",
	executable: "grok",
	processForm: "interactive",
	singleInstructionArgs(prompt: string, referencedPaths: readonly string[] = []): readonly string[] {
		// `--` so prompts like `help` / `--version` are not parsed as Grok CLI syntax.
		const instruction = instructionText(prompt, referencedPaths);
		return guardArgs(instruction.length > 0 ? ["--", instruction] : [], GROK_SKIP_FLAGS, "Grok");
	},
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths: readonly string[] = []): readonly string[] {
		const instruction = instructionText(prompt, referencedPaths);
		return guardArgs(
			["--resume", externalSessionId, ...(instruction.length > 0 ? ["--", instruction] : [])],
			GROK_SKIP_FLAGS,
			"Grok",
		);
	},
	locateSessionId(input): string | null {
		return locateGrokSessionId(input);
	},
};

export const ompAdapter: ExternalAgentAdapter = {
	id: "omp",
	label: "OMP",
	executable: "omp",
	processForm: "one-shot",
	singleInstructionArgs(prompt: string, referencedPaths: readonly string[] = []): readonly string[] {
		return guardArgs(["--print", instructionText(prompt, referencedPaths)], OMP_SKIP_FLAGS, "OMP");
	},
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths: readonly string[] = []): readonly string[] {
		const instruction = ompAdapter.singleInstructionArgs(prompt, referencedPaths)[1] ?? "";
		return guardArgs(["--print", instruction, "--resume", externalSessionId], OMP_SKIP_FLAGS, "OMP");
	},
	locateSessionId(input): string | null {
		return locateOmpSessionId(input);
	},
};

export const cursorAgentAdapter: ExternalAgentAdapter = {
	id: "cursor-agent",
	label: "cursor-agent",
	executable: "cursor-agent",
	processForm: "one-shot",
	singleInstructionArgs(prompt: string, referencedPaths: readonly string[] = []): readonly string[] {
		return guardArgs(["--print", instructionText(prompt, referencedPaths)], CURSOR_SKIP_FLAGS, "cursor-agent");
	},
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths: readonly string[] = []): readonly string[] {
		const instruction = cursorAgentAdapter.singleInstructionArgs(prompt, referencedPaths)[1] ?? "";
		return guardArgs(["--print", instruction, "--resume", externalSessionId], CURSOR_SKIP_FLAGS, "cursor-agent");
	},
	locateSessionId(input): string | null {
		return locateCursorAgentSessionId(input);
	},
};

/** PATH 上有命令才出现；空启动只起对方 TUI，还不接对方自己的会话文件。 */
function interactiveTuiAdapter(input: {
	readonly id: ExternalAgentId;
	readonly label: string;
	readonly executable: string;
	readonly promptMode: InteractivePromptMode;
}): ExternalAgentAdapter {
	const argsFor = (prompt: string, referencedPaths: readonly string[] = []): readonly string[] => {
		const instruction = instructionText(prompt, referencedPaths);
		if (instruction.length === 0) return [];
		switch (input.promptMode) {
			case "argv":
				return [instruction];
			case "argv-dashdash":
				return ["--", instruction];
			case "flag-prompt":
				return ["--prompt", instruction];
			case "flag-prompt-interactive":
				return ["--prompt-interactive", instruction];
		}
	};
	return {
		id: input.id,
		label: input.label,
		executable: input.executable,
		processForm: "interactive",
		singleInstructionArgs: argsFor,
		resumeArgs: (prompt, _externalSessionId, referencedPaths = []) => argsFor(prompt, referencedPaths),
		locateSessionId: () => null,
	};
}

export const agyAdapter: ExternalAgentAdapter = interactiveTuiAdapter({
	id: "agy",
	label: "agy",
	executable: "agy",
	promptMode: "flag-prompt-interactive",
});

export const codexAdapter: ExternalAgentAdapter = interactiveTuiAdapter({
	id: "codex",
	label: "codex",
	executable: "codex",
	promptMode: "argv",
});

export const piAdapter: ExternalAgentAdapter = interactiveTuiAdapter({
	id: "pi",
	label: "pi",
	executable: "pi",
	promptMode: "argv",
});

export const droidAdapter: ExternalAgentAdapter = interactiveTuiAdapter({
	id: "droid",
	label: "droid",
	executable: "droid",
	promptMode: "argv",
});

export const opencodeAdapter: ExternalAgentAdapter = interactiveTuiAdapter({
	id: "opencode",
	label: "opencode",
	executable: "opencode",
	promptMode: "flag-prompt",
});

export const externalAgentAdapters = [
	grokAdapter,
	ompAdapter,
	cursorAgentAdapter,
	agyAdapter,
	codexAdapter,
	piAdapter,
	droidAdapter,
	opencodeAdapter,
] as const;

/** 与输入栏 path token 同一写法：无空白则裸写，否则加引号。 */
function attachmentLine(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	return `@${/^[^\s"]+$/.test(normalized) ? normalized : `"${normalized.replace(/"/g, "")}"`}`;
}

/** 编辑器正文里已经有同一条 @路径 时去掉，避免拼到提问前面之后写两遍。 */
function questionWithoutAttachmentTokens(prompt: string, lines: readonly string[]): string {
	let body = prompt;
	for (const line of lines) body = body.split(line).join(" ");
	return body
		.replace(/[ \t]{2,}/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

export function findExternalAgentAdapter(agentId: string): ExternalAgentAdapter | undefined {
	return externalAgentAdapters.find((adapter) => adapter.id === agentId);
}

function instructionText(prompt: string, referencedPaths: readonly string[]): string {
	const lines = referencedPaths.map(attachmentLine);
	const question = questionWithoutAttachmentTokens(prompt, lines);
	return lines.length > 0 ? `${lines.join("\n")}\n${question}` : question;
}

function guardArgs(args: readonly string[], forbidden: readonly string[], agent: string): readonly string[] {
	for (const flag of forbidden) {
		if (args.includes(flag)) throw new Error(`${agent} single-instruction args must not include ${flag}`);
	}
	return args;
}
