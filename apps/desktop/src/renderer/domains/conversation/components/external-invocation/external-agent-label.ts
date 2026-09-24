const AGENT_LABEL_KEY = {
	grok: "externalInvocation.agent.grok",
	omp: "externalInvocation.agent.omp",
	"cursor-agent": "externalInvocation.agent.cursorAgent",
} as const;

export function externalAgentLabel(
	agentId: string | undefined,
	t: (key: (typeof AGENT_LABEL_KEY)[keyof typeof AGENT_LABEL_KEY]) => string,
): string {
	if (agentId === "grok" || agentId === "omp" || agentId === "cursor-agent") return t(AGENT_LABEL_KEY[agentId]);
	return "";
}
