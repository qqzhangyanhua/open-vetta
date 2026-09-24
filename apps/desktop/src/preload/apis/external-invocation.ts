import type { IpcRenderer, IpcRendererEvent } from "electron";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	listAgents: "external-invocation:list-agents",
	start: "external-invocation:start",
	event: "external-invocation:event",
} as const;

export interface ExternalInvocationEvent {
	readonly type: "running" | "completed" | "failed";
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
				return () => ipc.removeListener(CHANNELS.event, handler);
			},
		},
	};
}
