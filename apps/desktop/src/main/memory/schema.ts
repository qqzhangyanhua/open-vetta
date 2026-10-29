import { z } from "zod";
import {
	GLOBAL_MEMORY_SCHEMA_VERSION,
	type GlobalMemoryEntry,
	MEMORY_CATEGORIES,
	type SaveMemoryCandidate,
} from "../../shared/memory.js";

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
});

export interface GlobalMemoryDocument {
	readonly schemaVersion: typeof GLOBAL_MEMORY_SCHEMA_VERSION;
	readonly entries: readonly GlobalMemoryEntry[];
}

export const saveMemoryCandidatesSchema = z.object({
	candidates: z
		.array(
			z.object({
				text: z.string().trim().min(1).max(2_000),
				category: memoryCategorySchema,
			}),
		)
		.max(50),
});

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
