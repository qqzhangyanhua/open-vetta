import type { IpcRenderer } from "electron";
import { MEMORY_CHANNELS } from "../../shared/memory.js";
import type { DesktopApi } from "../api.js";

export function createMemoryApi(ipc: IpcRenderer): Pick<DesktopApi, "memory"> {
	return {
		memory: {
			listGlobal: () => ipc.invoke(MEMORY_CHANNELS.LIST_GLOBAL),
			generate: (runtimeId) => ipc.invoke(MEMORY_CHANNELS.GENERATE, runtimeId),
			save: (candidates) => ipc.invoke(MEMORY_CHANNELS.SAVE, candidates),
		},
	};
}
