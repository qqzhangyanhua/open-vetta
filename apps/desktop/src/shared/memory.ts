/** Desktop global memory contract shared by the main service, IPC, and renderer. */

export const MEMORY_CATEGORIES = ["identity", "family", "location", "work", "preference", "interest", "other"] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_SCOPES = ["global", "project"] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type ProjectMemoryKind = "conversation" | "local" | "ssh";

export const GLOBAL_MEMORY_SCHEMA_VERSION = 1;

export const PROJECT_MEMORY_SCHEMA_VERSION = 1;

export interface GlobalMemoryEntry {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	readonly recordedAt: string;
	/** Absent means not pinned. Only `true` is pinned. */
	readonly pinned?: boolean;
}

/**
 * Characters of entry text loaded for one scope.
 * Global and project each get this full amount; one scope being over does not shrink the other.
 * Pinned text may exceed it.
 */
export const MEMORY_SCOPE_CHAR_BUDGET = 4_000;

export function memoryEntryWithPinned(entry: GlobalMemoryEntry, pinned: boolean): GlobalMemoryEntry {
	if (pinned) return entry.pinned === true ? entry : { ...entry, pinned: true };
	if (entry.pinned !== true) return entry;
	return { id: entry.id, text: entry.text, category: entry.category, recordedAt: entry.recordedAt };
}

export interface MemoryCandidate {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	/** Model suggestion. The user can change it before save. */
	readonly scope: MemoryScope;
}

export interface SaveMemoryCandidate {
	/** Candidate id from generate. Save commits that generate's cursor, not a later one. */
	readonly id?: string;
	readonly text: string;
	readonly category: MemoryCategory;
	/** Omitted means global, so older save payloads stay global. */
	readonly scope?: MemoryScope;
}

export interface ProjectMemoryProject {
	readonly path: string;
	readonly kind: ProjectMemoryKind;
	readonly entries: readonly GlobalMemoryEntry[];
}

export function memoryScopeOf(candidate: { readonly scope?: string }): MemoryScope {
	return candidate.scope === "project" ? "project" : "global";
}

export type GenerateGlobalMemoryResult =
	| { readonly status: "empty" }
	| { readonly status: "candidates"; readonly candidates: readonly MemoryCandidate[] };

export interface MemoryModelChoice {
	readonly modelKey: string;
	readonly label: string;
}

export interface SetMemoryPinnedInput {
	readonly id: string;
	readonly scope: MemoryScope;
	/** Required when scope is project. Ignored for global. */
	readonly projectPath?: string;
	readonly pinned: boolean;
}

export interface DesktopMemoryApi {
	listGlobal: () => Promise<GlobalMemoryEntry[]>;
	listProjects: () => Promise<ProjectMemoryProject[]>;
	generate: (runtimeId: string) => Promise<GenerateGlobalMemoryResult>;
	save: (candidates: readonly SaveMemoryCandidate[]) => Promise<GlobalMemoryEntry[]>;
	getReadEnabled: () => Promise<boolean>;
	setReadEnabled: (enabled: boolean) => Promise<boolean>;
	getProjectReadEnabled: () => Promise<boolean>;
	setProjectReadEnabled: (enabled: boolean) => Promise<boolean>;
	/** `null` means generation uses the session's current model. */
	getModelOverride: () => Promise<string | null>;
	setModelOverride: (modelKey: string | null) => Promise<void>;
	listModels: () => Promise<readonly MemoryModelChoice[]>;
	setPinned: (input: SetMemoryPinnedInput) => Promise<GlobalMemoryEntry>;
}

export const MEMORY_CHANNELS = {
	LIST_GLOBAL: "memory:list-global",
	GENERATE: "memory:generate",
	SAVE: "memory:save",
	LIST_PROJECTS: "memory:list-projects",
	GET_READ_ENABLED: "memory:get-read-enabled",
	SET_READ_ENABLED: "memory:set-read-enabled",
	GET_PROJECT_READ_ENABLED: "memory:get-project-read-enabled",
	SET_PROJECT_READ_ENABLED: "memory:set-project-read-enabled",
	GET_MODEL_OVERRIDE: "memory:get-model-override",
	SET_MODEL_OVERRIDE: "memory:set-model-override",
	LIST_MODELS: "memory:list-models",
	SET_PINNED: "memory:set-pinned",
} as const;
