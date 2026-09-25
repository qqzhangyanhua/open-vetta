const AGENT_LABEL_KEY = {
	grok: "externalInvocation.agent.grok",
	omp: "externalInvocation.agent.omp",
	"cursor-agent": "externalInvocation.agent.cursorAgent",
	agy: "externalInvocation.agent.agy",
	codex: "externalInvocation.agent.codex",
	pi: "externalInvocation.agent.pi",
	droid: "externalInvocation.agent.droid",
	opencode: "externalInvocation.agent.opencode",
} as const;

export function externalAgentLabel(
	agentId: string | undefined,
	t: (key: (typeof AGENT_LABEL_KEY)[keyof typeof AGENT_LABEL_KEY]) => string,
): string {
	if (agentId && agentId in AGENT_LABEL_KEY) return t(AGENT_LABEL_KEY[agentId as keyof typeof AGENT_LABEL_KEY]);
	return agentId ?? "";
}
