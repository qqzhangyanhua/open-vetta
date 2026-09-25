export function parseExternalInvocationStart(value: unknown): {
	sessionId: string;
	cwd: string;
	prompt: string;
	agentId: string;
	referencedPaths: readonly string[];
	externalSessionId: string | null;
	newSession: boolean;
	historyResume?: { externalSessionId: string; cwd: string };
} {
	if (typeof value !== "object" || value === null) throw new Error("external invocation: request must be an object");
	const input = value as Record<string, unknown>;
	const sessionId = requireString(input.sessionId, "sessionId");
	const cwd = requireString(input.cwd, "cwd");
	const agentId = requireString(input.agentId, "agentId");
	if (typeof input.prompt !== "string") throw new Error("external invocation: prompt must be a string");
	const prompt = input.prompt;
	const referencedPaths = Array.isArray(input.referencedPaths)
		? input.referencedPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
		: [];
	const externalSessionId =
		typeof input.externalSessionId === "string" && input.externalSessionId.length > 0
			? input.externalSessionId
			: null;
	const historyResume = parseHistoryResume(input.historyResume);
	return {
		sessionId,
		cwd,
		prompt,
		agentId,
		referencedPaths,
		externalSessionId: historyResume?.externalSessionId ?? externalSessionId,
		newSession: input.newSession === true,
		...(historyResume ? { historyResume } : {}),
	};
}

function parseHistoryResume(value: unknown): { externalSessionId: string; cwd: string } | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const input = value as Record<string, unknown>;
	if (typeof input.externalSessionId !== "string" || input.externalSessionId.length === 0) return undefined;
	if (typeof input.cwd !== "string" || input.cwd.length === 0) return undefined;
	return { externalSessionId: input.externalSessionId, cwd: input.cwd };
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`external invocation: ${field} must be a non-empty string`);
	}
	return value;
}
