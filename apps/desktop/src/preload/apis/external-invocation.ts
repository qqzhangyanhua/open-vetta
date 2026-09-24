import type { IpcRenderer, IpcRendererEvent } from "electron";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	listAgents: "external-invocation:list-agents",
	start: "external-invocation:start",
	event: "external-invocation:event",
	writeInput: "external-invocation:write-input",
	stop: "external-invocation:stop",
	readOutput: "external-invocation:read-output",
	attach: "external-invocation:attach",
	detach: "external-invocation:detach",
	watchRunning: "external-invocation:watch-running",
	running: "external-invocation:running",
} as const;

export interface ExternalInvocationEvent {
	readonly type: "running" | "completed" | "failed" | "interrupted" | "output" | "truncated";
	readonly chunk?: string;
	readonly sessionId: string;
	readonly invocationId: string;
	readonly agentId?: string;
	readonly prompt?: string;
	readonly exitCode?: number | null;
	readonly reason?: string;
	readonly discardedBytes?: number;
}

export function createExternalInvocationApi(ipc: IpcRenderer): Pick<DesktopApi, "externalInvocations"> {
	return {
		externalInvocations: {
			listAgents: () => ipc.invoke(CHANNELS.listAgents),
			start: (request) => ipc.invoke(CHANNELS.start, request),
			subscribe: (sessionId, listener) => {
				const handler = (_event: IpcRendererEvent, update: ExternalInvocationEvent): void => {
					if (update.sessionId === sessionId) listener(update);
				};
				ipc.on(CHANNELS.event, handler);
				let attached = false;
				let disposed = false;
				void ipc.invoke(CHANNELS.attach, sessionId).then(() => {
					attached = true;
					if (disposed) void ipc.invoke(CHANNELS.detach, sessionId);
				});
				return () => {
					disposed = true;
					ipc.removeListener(CHANNELS.event, handler);
					if (attached) void ipc.invoke(CHANNELS.detach, sessionId);
				};
			},
			subscribeRunning: (listener) => {
				const handler = (_event: IpcRendererEvent, sessionIds: readonly string[]): void => {
					listener(sessionIds);
				};
				ipc.on(CHANNELS.running, handler);
				void ipc.invoke(CHANNELS.watchRunning);
				return () => ipc.removeListener(CHANNELS.running, handler);
			},
			writeInput: (invocationId, data) => ipc.invoke(CHANNELS.writeInput, invocationId, data),
			stop: (invocationId) => ipc.invoke(CHANNELS.stop, invocationId),
			readOutput: (sessionId, invocationId) => ipc.invoke(CHANNELS.readOutput, sessionId, invocationId),
		},
	};
}
