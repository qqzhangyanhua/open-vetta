export interface DesktopExternalInvocationEvent {
	readonly type: "running" | "queued" | "completed" | "failed" | "interrupted" | "output" | "truncated";
	readonly chunk?: string;
	readonly sessionId: string;
	readonly invocationId: string;
	readonly agentId?: string;
	readonly prompt?: string;
	readonly exitCode?: number | null;
	readonly reason?: "user" | "app-exit" | "cancelled" | string;
	readonly message?: string;
	readonly discardedBytes?: number;
	readonly ordinal?: number;
	readonly externalSessionId?: string | null;
	readonly startedAt?: string;
}

export interface DesktopExternalInvocationsApi {
	listAgents(): Promise<readonly { id: "grok"; label: string; executable: "grok" }[]>;
	start(request: {
		sessionId: string;
		cwd: string;
		prompt: string;
		agentId: string;
		referencedPaths?: readonly string[];
		externalSessionId?: string | null;
		newSession?: boolean;
	}): Promise<{ invocationId: string }>;
	subscribe(sessionId: string, listener: (event: DesktopExternalInvocationEvent) => void): () => void;
	subscribeRunning(listener: (sessionIds: readonly string[]) => void): () => void;
	writeInput(invocationId: string, data: string): Promise<void>;
	stop(invocationId: string): Promise<void>;
	readOutput(
		sessionId: string,
		invocationId: string,
	): Promise<{ head: string; tail: string; discardedBytes: number } | null>;
}
