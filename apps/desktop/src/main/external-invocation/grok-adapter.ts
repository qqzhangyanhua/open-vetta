/** 单条指令只带提示本身。确认、信任和跳过权限都留给 Grok 自己的终端询问。 */
const SKIP_CONFIRMATION_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"] as const;

export interface ExternalAgentAdapter {
	readonly id: "grok";
	readonly label: "Grok";
	readonly executable: "grok";
	singleInstructionArgs(prompt: string): readonly string[];
}

export const grokAdapter: ExternalAgentAdapter = {
	id: "grok",
	label: "Grok",
	executable: "grok",
	singleInstructionArgs(prompt: string): readonly string[] {
		const args = ["--single", prompt];
		for (const flag of SKIP_CONFIRMATION_FLAGS) {
			if (args.includes(flag)) {
				throw new Error(`Grok single-instruction args must not include ${flag}`);
			}
		}
		return args;
	},
};

export const externalAgentAdapters = [grokAdapter] as const;

export function findExternalAgentAdapter(agentId: string): ExternalAgentAdapter | undefined {
	return externalAgentAdapters.find((adapter) => adapter.id === agentId);
}
