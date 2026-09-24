export const EXTERNAL_INVOCATION_CUSTOM_TYPE = "vetta.external_invocation";

export type ExternalInvocationStatus = "running" | "completed" | "failed";

export interface ExternalInvocationRecord {
	readonly invocationId: string;
	readonly agentId: string;
	readonly prompt: string;
	readonly status: ExternalInvocationStatus;
	readonly exitCode: number | null;
	readonly failureReason: string | null;
	readonly discardedBytes: number;
}

export function parseExternalInvocationRecord(data: unknown): ExternalInvocationRecord | undefined {
	if (!isRecord(data)) return undefined;
	const invocationId = data.invocationId;
	const agentId = data.agentId;
	const prompt = data.prompt;
	const status = data.status;
	if (typeof invocationId !== "string" || invocationId.length === 0) return undefined;
	if (typeof agentId !== "string" || agentId.length === 0) return undefined;
	if (typeof prompt !== "string") return undefined;
	if (status !== "running" && status !== "completed" && status !== "failed") return undefined;
	const exitCode = data.exitCode;
	if (exitCode !== null && exitCode !== undefined && typeof exitCode !== "number") return undefined;
	const failureReason = data.failureReason;
	if (failureReason !== null && failureReason !== undefined && typeof failureReason !== "string") return undefined;
	const discardedBytes = data.discardedBytes;
	return {
		invocationId,
		agentId,
		prompt,
		status,
		exitCode: typeof exitCode === "number" ? exitCode : null,
		failureReason: typeof failureReason === "string" ? failureReason : null,
		discardedBytes: typeof discardedBytes === "number" && discardedBytes >= 0 ? discardedBytes : 0,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
