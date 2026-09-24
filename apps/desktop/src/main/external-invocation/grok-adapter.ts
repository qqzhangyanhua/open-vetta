/** 单条指令只带提示本身。确认、信任和跳过权限都留给 Grok 自己的终端询问。 */
const SKIP_CONFIRMATION_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"] as const;

export interface ExternalAgentAdapter {
	readonly id: "grok";
	readonly label: "Grok";
	readonly executable: "grok";
	singleInstructionArgs(prompt: string, referencedPaths?: readonly string[]): readonly string[];
}

export const grokAdapter: ExternalAgentAdapter = {
	id: "grok",
	label: "Grok",
	executable: "grok",
	singleInstructionArgs(prompt: string, referencedPaths: readonly string[] = []): readonly string[] {
		const lines = referencedPaths.map(attachmentLine);
		const question = questionWithoutAttachmentTokens(prompt, lines);
		const instruction = lines.length > 0 ? `${lines.join("\n")}\n${question}` : question;
		const args = ["--single", instruction];
		for (const flag of SKIP_CONFIRMATION_FLAGS) {
			if (args.includes(flag)) {
				throw new Error(`Grok single-instruction args must not include ${flag}`);
			}
		}
		return args;
	},
};

export const externalAgentAdapters = [grokAdapter] as const;

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
