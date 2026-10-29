import { ipcMain } from "electron";
import { z } from "zod";
import { type GenerateGlobalMemoryResult, type GlobalMemoryEntry, MEMORY_CHANNELS } from "../../shared/memory.js";
import { parseSaveMemoryCandidates } from "../memory/schema.js";
import type { DesktopMemoryService } from "../memory/service.js";

const runtimeIdSchema = z.string().trim().min(1).max(256);

/** Narrow surface so IPC tests can inject a fake without constructing the service. */
export interface MemoryIpcService {
	listGlobal(): Promise<GlobalMemoryEntry[]>;
	generate(runtimeId: string): Promise<GenerateGlobalMemoryResult>;
	save(candidates: unknown): Promise<GlobalMemoryEntry[]>;
}

export function registerMemoryIpc(service: MemoryIpcService | DesktopMemoryService): () => void {
	ipcMain.handle(MEMORY_CHANNELS.LIST_GLOBAL, () => service.listGlobal());
	ipcMain.handle(MEMORY_CHANNELS.GENERATE, (_event, runtimeId: unknown) =>
		service.generate(runtimeIdSchema.parse(runtimeId)),
	);
	ipcMain.handle(MEMORY_CHANNELS.SAVE, (_event, candidates: unknown) =>
		service.save(parseSaveMemoryCandidates(candidates)),
	);
	return () => {
		for (const channel of Object.values(MEMORY_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
