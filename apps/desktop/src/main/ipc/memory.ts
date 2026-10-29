import { ipcMain } from "electron";
import { z } from "zod";
import {
	type GenerateGlobalMemoryResult,
	type GlobalMemoryEntry,
	MEMORY_CHANNELS,
	type MemoryModelChoice,
	type ProjectMemoryProject,
	type UpdateMemoryEntry,
} from "../../shared/memory.js";
import { parseDeleteMemoryEntryId, parseSaveMemoryCandidates, parseUpdateMemoryEntry } from "../memory/schema.js";
import type { DesktopMemoryService } from "../memory/service.js";

const runtimeIdSchema = z.string().trim().min(1).max(256);
const modelOverrideArgumentSchema = z.union([z.null(), z.string().max(300)]);

/** Narrow surface so IPC tests can inject a fake without constructing the service. */
export interface MemoryIpcService {
	listGlobal(): Promise<GlobalMemoryEntry[]>;
	listProjects(): Promise<ProjectMemoryProject[]>;
	generate(runtimeId: string): Promise<GenerateGlobalMemoryResult>;
	save(candidates: unknown): Promise<GlobalMemoryEntry[]>;
	updateEntry(input: UpdateMemoryEntry): Promise<void>;
	deleteEntry(id: string): Promise<void>;
	getReadEnabled(): Promise<boolean>;
	setReadEnabled(enabled: boolean): Promise<boolean>;
	getProjectReadEnabled(): Promise<boolean>;
	setProjectReadEnabled(enabled: boolean): Promise<boolean>;
	getModelOverride(): Promise<string | null>;
	setModelOverride(modelKey: string | null): Promise<void>;
	listModels(): Promise<readonly MemoryModelChoice[]>;
}

export function registerMemoryIpc(service: MemoryIpcService | DesktopMemoryService): () => void {
	ipcMain.handle(MEMORY_CHANNELS.LIST_GLOBAL, () => service.listGlobal());
	ipcMain.handle(MEMORY_CHANNELS.LIST_PROJECTS, () => service.listProjects());
	ipcMain.handle(MEMORY_CHANNELS.GENERATE, (_event, runtimeId: unknown) =>
		service.generate(runtimeIdSchema.parse(runtimeId)),
	);
	ipcMain.handle(MEMORY_CHANNELS.SAVE, (_event, candidates: unknown) =>
		service.save(parseSaveMemoryCandidates(candidates)),
	);
	ipcMain.handle(MEMORY_CHANNELS.UPDATE_ENTRY, (_event, input: unknown) =>
		service.updateEntry(parseUpdateMemoryEntry(input)),
	);
	ipcMain.handle(MEMORY_CHANNELS.DELETE_ENTRY, (_event, id: unknown) =>
		service.deleteEntry(parseDeleteMemoryEntryId(id)),
	);
	ipcMain.handle(MEMORY_CHANNELS.GET_READ_ENABLED, () => service.getReadEnabled());
	ipcMain.handle(MEMORY_CHANNELS.SET_READ_ENABLED, (_event, enabled: unknown) =>
		service.setReadEnabled(z.boolean().parse(enabled)),
	);
	ipcMain.handle(MEMORY_CHANNELS.GET_PROJECT_READ_ENABLED, () => service.getProjectReadEnabled());
	ipcMain.handle(MEMORY_CHANNELS.SET_PROJECT_READ_ENABLED, (_event, enabled: unknown) =>
		service.setProjectReadEnabled(z.boolean().parse(enabled)),
	);
	ipcMain.handle(MEMORY_CHANNELS.GET_MODEL_OVERRIDE, () => service.getModelOverride());
	ipcMain.handle(MEMORY_CHANNELS.LIST_MODELS, () => service.listModels());
	ipcMain.handle(MEMORY_CHANNELS.SET_MODEL_OVERRIDE, (_event, modelKey: unknown) => {
		const parsed = modelOverrideArgumentSchema.safeParse(modelKey);
		if (!parsed.success) throw new Error("memory:invalid-model");
		return service.setModelOverride(parsed.data);
	});
	return () => {
		for (const channel of Object.values(MEMORY_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
