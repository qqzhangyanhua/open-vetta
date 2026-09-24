export interface DesktopExternalInvocationEvent {
	readonly type: "running" | "completed" | "failed";
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
}
