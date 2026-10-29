/** Desktop global memory contract shared by the main service, IPC, and renderer. */

export const MEMORY_CATEGORIES = ["identity", "family", "location", "work", "preference", "interest", "other"] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const GLOBAL_MEMORY_SCHEMA_VERSION = 1;

export interface GlobalMemoryEntry {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	readonly recordedAt: string;
}

export interface MemoryCandidate {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
}

export interface SaveMemoryCandidate {
	readonly text: string;
	readonly category: MemoryCategory;
}

export type GenerateGlobalMemoryResult =
	| { readonly status: "empty" }
	| { readonly status: "candidates"; readonly candidates: readonly MemoryCandidate[] };

export interface DesktopMemoryApi {
	listGlobal: () => Promise<GlobalMemoryEntry[]>;
	generate: (runtimeId: string) => Promise<GenerateGlobalMemoryResult>;
	save: (candidates: readonly SaveMemoryCandidate[]) => Promise<GlobalMemoryEntry[]>;
}

export const MEMORY_CHANNELS = {
	LIST_GLOBAL: "memory:list-global",
	GENERATE: "memory:generate",
	SAVE: "memory:save",
} as const;
