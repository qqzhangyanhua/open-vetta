import { locateCursorAgentSessionId, locateOmpSessionId } from "../external-sessions/external-agent-session-id.js";
import { locateGrokSessionId } from "../external-sessions/grok-session-locator.js";

/** 确认、信任和跳过权限都留给对方自己的终端询问，适配器不代传这些参数。 */
const GROK_SKIP_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"] as const;
const OMP_SKIP_FLAGS = ["--auto-approve", "--approval-mode", "--plan-yolo"] as const;
const CURSOR_SKIP_FLAGS = ["--force", "-f", "--yolo", "--trust", "--approve-mcps"] as const;

export type ExternalAgentId = "grok" | "omp" | "cursor-agent";

export interface ExternalAgentAdapter {
	readonly id: ExternalAgentId;
	readonly label: string;
	readonly executable: ExternalAgentId;
	singleInstructionArgs(prompt: string, referencedPaths?: readonly string[]): readonly string[];
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths?: readonly string[]): readonly string[];
	locateSessionId(input: { sessionsRoot: string; cwd: string; startedAt: number }): string | null;
}

export const grokAdapter: ExternalAgentAdapter = {
	id: "grok",
	label: "Grok",
	executable: "grok",
	singleInstructionArgs(prompt: string, referencedPaths: readonly string[] = []): readonly string[] {
		return guardArgs(["--single", instructionText(prompt, referencedPaths)], GROK_SKIP_FLAGS, "Grok");
	},
	resumeArgs(prompt: string, externalSessionId: string, referencedPaths: readonly string[] = []): readonly string[] {
		const instruction = grokAdapter.singleInstructionArgs(prompt, referencedPaths)[1] ?? "";
		return guardArgs(["--single", instruction, "--resume", externalSessionId], GROK_SKIP_FLAGS, "Grok");
	},
	locateSessionId(input): string | null {
		return locateGrokSessionId(input);
	},
};

export const ompAdapter: ExternalAgentAdapter = {
	id: "omp",
	label: "OMP",
	executable: "omp",
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

export const externalAgentAdapters = [grokAdapter, ompAdapter, cursorAgentAdapter] as const;

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
