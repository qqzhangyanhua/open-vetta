import { z } from "zod";
import {
	GLOBAL_MEMORY_SCHEMA_VERSION,
	type GlobalMemoryEntry,
	MEMORY_CATEGORIES,
	MEMORY_SCOPES,
	PROJECT_MEMORY_SCHEMA_VERSION,
	type ProjectMemoryKind,
	type SaveMemoryCandidate,
	type UpdateMemoryEntry,
} from "../../shared/memory.js";

export const MEMORY_GENERATION_SCHEMA_VERSION = 1;

/** `provider/modelId`; the id may itself contain slashes. */
const MEMORY_MODEL_KEY = /^[^\s/]+\/[^\s]+$/u;

export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);

const recordedAtSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const globalMemoryEntrySchema = z.object({
	id: z.uuid(),
	text: z.string().trim().min(1).max(2_000),
	category: memoryCategorySchema,
	recordedAt: recordedAtSchema,
});

export const globalMemoryDocumentSchema = z.object({
	schemaVersion: z.literal(GLOBAL_MEMORY_SCHEMA_VERSION),
	entries: z.array(globalMemoryEntrySchema).max(5_000),
	globalEnabled: z.boolean().optional(),
});

export interface GlobalMemoryDocument {
	readonly schemaVersion: typeof GLOBAL_MEMORY_SCHEMA_VERSION;
	readonly entries: readonly GlobalMemoryEntry[];
	/** 缺省视为打开。只有用户关掉读取时才写入 false。 */
	readonly globalEnabled?: boolean;
}

export function isGlobalMemoryReadEnabled(document: Pick<GlobalMemoryDocument, "globalEnabled">): boolean {
	return document.globalEnabled !== false;
}

export const saveMemoryCandidatesSchema = z.object({
	candidates: z
		.array(
			z.object({
				id: z.uuid().optional(),
				text: z.string().trim().min(1).max(2_000),
				category: memoryCategorySchema,
				scope: z.enum(MEMORY_SCOPES).optional(),
			}),
		)
		.max(50),
});

export const projectMemoryRecordSchema = z.object({
	path: z.string().trim().min(1).max(4_096),
	entries: z.array(globalMemoryEntrySchema).max(5_000),
});

export const projectMemoryDocumentSchema = z.object({
	schemaVersion: z.literal(PROJECT_MEMORY_SCHEMA_VERSION),
	projectEnabled: z.boolean().optional(),
	projects: z.array(projectMemoryRecordSchema).max(2_000),
});

export interface ProjectMemoryRecord {
	readonly path: string;
	readonly entries: readonly GlobalMemoryEntry[];
}

export interface ProjectMemoryDocument {
	readonly schemaVersion: typeof PROJECT_MEMORY_SCHEMA_VERSION;
	readonly projects: readonly ProjectMemoryRecord[];
	/** 缺省视为打开。只有用户关掉读取时才写入 false。 */
	readonly projectEnabled?: boolean;
}

export function isProjectMemoryReadEnabled(document: Pick<ProjectMemoryDocument, "projectEnabled">): boolean {
	return document.projectEnabled !== false;
}

export function emptyProjectMemoryDocument(): ProjectMemoryDocument {
	return { schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION, projects: [] };
}

export function normalizeProjectMemoryDocument(value: unknown): ProjectMemoryDocument {
	if (value === undefined) return emptyProjectMemoryDocument();
	const parsed = projectMemoryDocumentSchema.safeParse(value);
	if (!parsed.success) throw new Error("memory:store-rejected");
	const seen = new Set<string>();
	for (const project of parsed.data.projects) {
		if (seen.has(project.path)) throw new Error("memory:store-rejected");
		seen.add(project.path);
	}
	return {
		schemaVersion: parsed.data.schemaVersion,
		projects: parsed.data.projects,
		...(parsed.data.projectEnabled === undefined ? {} : { projectEnabled: parsed.data.projectEnabled }),
	};
}

export function projectMemoryKindOf(path: string, conversationRoot: string): ProjectMemoryKind {
	if (path.startsWith("ssh://")) return "ssh";
	if (path === conversationRoot) return "conversation";
	return "local";
}

export function emptyGlobalMemoryDocument(): GlobalMemoryDocument {
	return { schemaVersion: GLOBAL_MEMORY_SCHEMA_VERSION, entries: [] };
}

export function normalizeGlobalMemoryDocument(value: unknown): GlobalMemoryDocument {
	if (value === undefined) return emptyGlobalMemoryDocument();
	const parsed = globalMemoryDocumentSchema.safeParse(value);
	if (!parsed.success) throw new Error("memory:store-rejected");
	return parsed.data;
}

export function parseSaveMemoryCandidates(value: unknown): SaveMemoryCandidate[] {
	const parsed = saveMemoryCandidatesSchema.safeParse(Array.isArray(value) ? { candidates: value } : value);
	if (!parsed.success) throw new Error("memory:invalid-candidates");
	return parsed.data.candidates;
}

export const updateMemoryEntrySchema = z.object({
	id: z.uuid(),
	text: z.string().trim().min(1).max(2_000),
	category: memoryCategorySchema,
	scope: z.enum(MEMORY_SCOPES),
	projectPath: z.string().trim().min(1).max(4_096).optional(),
});

export function parseUpdateMemoryEntry(value: unknown): UpdateMemoryEntry {
	const parsed = updateMemoryEntrySchema.safeParse(value);
	if (!parsed.success) throw new Error("memory:invalid-entry");
	if (parsed.data.scope === "global") {
		return {
			id: parsed.data.id,
			text: parsed.data.text,
			category: parsed.data.category,
			scope: "global",
		};
	}
	const projectPath = parsed.data.projectPath;
	if (!projectPath) throw new Error("memory:invalid-entry");
	return {
		id: parsed.data.id,
		text: parsed.data.text,
		category: parsed.data.category,
		scope: "project",
		projectPath,
	};
}

export function parseDeleteMemoryEntryId(value: unknown): string {
	const parsed = z.uuid().safeParse(value);
	if (!parsed.success) throw new Error("memory:invalid-entry");
	return parsed.data;
}

const memoryModelKeySchema = z.string().regex(MEMORY_MODEL_KEY).max(300);

const memoryGenerationCursorSchema = z.object({
	runtimeId: z.string().trim().min(1).max(256),
	entryId: z.string().trim().min(1).max(512),
});

/** One cursor per runtime. Past this, the oldest runtimes are dropped on write. */
export const MEMORY_GENERATION_CURSOR_LIMIT = 5_000;

export const memoryGenerationDocumentSchema = z.object({
	schemaVersion: z.literal(MEMORY_GENERATION_SCHEMA_VERSION),
	modelKey: memoryModelKeySchema.optional(),
	cursors: z.array(memoryGenerationCursorSchema).max(MEMORY_GENERATION_CURSOR_LIMIT).default([]),
});

export interface MemoryGenerationCursor {
	readonly runtimeId: string;
	readonly entryId: string;
}

export interface MemoryGenerationDocument {
	readonly schemaVersion: typeof MEMORY_GENERATION_SCHEMA_VERSION;
	readonly modelKey?: string;
	readonly cursors: readonly MemoryGenerationCursor[];
}

export function emptyMemoryGenerationDocument(): MemoryGenerationDocument {
	return { schemaVersion: MEMORY_GENERATION_SCHEMA_VERSION, cursors: [] };
}

export function isMemoryModelKey(value: string): boolean {
	return value.length <= 300 && MEMORY_MODEL_KEY.test(value);
}

/** `null` clears the override. Empty is unset. Anything else must be a model key. */
export function parseMemoryModelOverride(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") throw new Error("memory:invalid-model");
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (!isMemoryModelKey(trimmed)) throw new Error("memory:invalid-model");
	return trimmed;
}

export function normalizeMemoryGenerationDocument(value: unknown): MemoryGenerationDocument {
	if (value === undefined) return emptyMemoryGenerationDocument();
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("memory:store-rejected");
	}
	if ("modelKey" in value && value.modelKey !== undefined && !isStoredModelKey(value.modelKey)) {
		throw new Error("memory:invalid-model");
	}
	const parsed = memoryGenerationDocumentSchema.safeParse(value);
	if (!parsed.success) throw new Error("memory:store-rejected");
	return {
		schemaVersion: parsed.data.schemaVersion,
		...(parsed.data.modelKey ? { modelKey: parsed.data.modelKey } : {}),
		cursors: parsed.data.cursors,
	};
}

function isStoredModelKey(value: unknown): value is string {
	return typeof value === "string" && isMemoryModelKey(value);
}

/** Cursors from a generation file whose modelKey cannot be kept. Does not accept that key. */
export function memoryGenerationCursors(value: unknown): readonly MemoryGenerationCursor[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("memory:store-rejected");
	}
	if ("schemaVersion" in value && value.schemaVersion !== MEMORY_GENERATION_SCHEMA_VERSION) {
		throw new Error("memory:store-rejected");
	}
	const cursors = "cursors" in value ? value.cursors : [];
	const parsed = z
		.array(memoryGenerationCursorSchema)
		.max(MEMORY_GENERATION_CURSOR_LIMIT)
		.safeParse(cursors ?? []);
	if (!parsed.success) throw new Error("memory:store-rejected");
	return parsed.data;
}
