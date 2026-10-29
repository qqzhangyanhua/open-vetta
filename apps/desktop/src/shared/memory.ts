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
	/** Candidate id from generate. Save commits that generate's cursor, not a later one. */
	readonly id?: string;
	readonly text: string;
	readonly category: MemoryCategory;
}

export type GenerateGlobalMemoryResult =
	| { readonly status: "empty" }
	| { readonly status: "candidates"; readonly candidates: readonly MemoryCandidate[] };

export interface MemoryModelChoice {
	readonly modelKey: string;
	readonly label: string;
}

export interface DesktopMemoryApi {
	listGlobal: () => Promise<GlobalMemoryEntry[]>;
	generate: (runtimeId: string) => Promise<GenerateGlobalMemoryResult>;
	save: (candidates: readonly SaveMemoryCandidate[]) => Promise<GlobalMemoryEntry[]>;
	getReadEnabled: () => Promise<boolean>;
	setReadEnabled: (enabled: boolean) => Promise<boolean>;
	/** `null` means generation uses the session's current model. */
	getModelOverride: () => Promise<string | null>;
	setModelOverride: (modelKey: string | null) => Promise<void>;
	listModels: () => Promise<readonly MemoryModelChoice[]>;
}

export const MEMORY_CHANNELS = {
	LIST_GLOBAL: "memory:list-global",
	GENERATE: "memory:generate",
	SAVE: "memory:save",
	GET_READ_ENABLED: "memory:get-read-enabled",
	SET_READ_ENABLED: "memory:set-read-enabled",
	GET_MODEL_OVERRIDE: "memory:get-model-override",
	SET_MODEL_OVERRIDE: "memory:set-model-override",
	LIST_MODELS: "memory:list-models",
} as const;
