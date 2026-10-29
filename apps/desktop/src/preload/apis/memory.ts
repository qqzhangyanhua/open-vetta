import type { IpcRenderer } from "electron";
import { MEMORY_CHANNELS } from "../../shared/memory.js";
import type { DesktopApi } from "../api.js";

export function createMemoryApi(ipc: IpcRenderer): Pick<DesktopApi, "memory"> {
	return {
		memory: {
			listGlobal: () => ipc.invoke(MEMORY_CHANNELS.LIST_GLOBAL),
			generate: (runtimeId) => ipc.invoke(MEMORY_CHANNELS.GENERATE, runtimeId),
			save: (candidates) => ipc.invoke(MEMORY_CHANNELS.SAVE, candidates),
			getReadEnabled: () => ipc.invoke(MEMORY_CHANNELS.GET_READ_ENABLED),
			setReadEnabled: (enabled) => ipc.invoke(MEMORY_CHANNELS.SET_READ_ENABLED, enabled),
			getModelOverride: () => ipc.invoke(MEMORY_CHANNELS.GET_MODEL_OVERRIDE),
			setModelOverride: (modelKey) => ipc.invoke(MEMORY_CHANNELS.SET_MODEL_OVERRIDE, modelKey),
			listModels: () => ipc.invoke(MEMORY_CHANNELS.LIST_MODELS),
		},
	};
}
