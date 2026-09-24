export interface DesktopExternalInvocationEvent {
	readonly type: "running" | "completed" | "failed" | "output" | "truncated";
	readonly chunk?: string;
	readonly sessionId: string;
	readonly invocationId: string;
	readonly agentId?: string;
	readonly prompt?: string;
	readonly exitCode?: number | null;
	readonly reason?: string;
	readonly discardedBytes?: number;
}

export interface DesktopExternalInvocationsApi {
	listAgents(): Promise<readonly { id: "grok"; label: string; executable: "grok" }[]>;
	start(request: {
		sessionId: string;
		cwd: string;
		prompt: string;
		agentId: string;
	}): Promise<{ invocationId: string }>;
	subscribe(sessionId: string, listener: (event: DesktopExternalInvocationEvent) => void): () => void;
	writeInput(invocationId: string, data: string): Promise<void>;
	stop(invocationId: string): Promise<void>;
	readOutput(
		sessionId: string,
		invocationId: string,
	): Promise<{ head: string; tail: string; discardedBytes: number } | null>;
}
