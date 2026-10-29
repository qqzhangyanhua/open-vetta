import {
	type GlobalMemoryEntry,
	type MemoryScope,
	memoryScopeOf,
	type SaveMemoryCandidate,
} from "../../shared/memory.js";
import type { GlobalMemoryDocument, ProjectMemoryDocument } from "./schema.js";

export interface ProjectMemoryBucket {
	path: string;
	entries: GlobalMemoryEntry[];
}

export interface ScopedMemorySaveResult {
	readonly globalEntries: GlobalMemoryEntry[];
	readonly projects: ProjectMemoryBucket[];
	readonly added: readonly { readonly candidate: SaveMemoryCandidate; readonly entry: GlobalMemoryEntry }[];
}

export function touchesProjectMemory(
	additions: readonly SaveMemoryCandidate[],
	updates: ReadonlyMap<string, SaveMemoryCandidate>,
	parsed: readonly SaveMemoryCandidate[],
	savedScope: (candidate: SaveMemoryCandidate) => MemoryScope | undefined,
): boolean {
	if (additions.some((candidate) => memoryScopeOf(candidate) === "project")) return true;
	if ([...updates.values()].some((candidate) => memoryScopeOf(candidate) === "project")) return true;
	return parsed.some((candidate) => savedScope(candidate) === "project");
}

/**
 * Writes global, then project. If the project write fails, the global file is put back
 * so a failed save did not keep either side. Remembering happens only after both writes.
 */
export async function commitScopedMemorySave(input: {
	readonly document: GlobalMemoryDocument;
	readonly projectDocument: ProjectMemoryDocument;
	readonly additions: readonly SaveMemoryCandidate[];
	readonly updates: ReadonlyMap<string, SaveMemoryCandidate>;
	readonly savedScopeByEntryId: ReadonlyMap<string, MemoryScope>;
	readonly projectPath: string;
	readonly recordedAt: string;
	readonly createId: () => string;
	readonly writeGlobal: (document: GlobalMemoryDocument) => Promise<void>;
	readonly writeProject: (document: ProjectMemoryDocument) => Promise<void>;
	readonly remember: (additions: readonly SaveMemoryCandidate[], added: readonly GlobalMemoryEntry[]) => void;
	readonly commitCursor: () => Promise<void>;
	readonly forget: () => void;
}): Promise<GlobalMemoryEntry[]> {
	const next = applyScopedMemorySave({
		globalEntries: input.document.entries,
		projects: input.projectDocument.projects,
		additions: input.additions,
		updates: input.updates,
		savedScopeByEntryId: input.savedScopeByEntryId,
		projectPath: input.projectPath,
		recordedAt: input.recordedAt,
		createId: input.createId,
	});
	const globalChanged = JSON.stringify(input.document.entries) !== JSON.stringify(next.globalEntries);
	const projectsChanged = JSON.stringify(input.projectDocument.projects) !== JSON.stringify(next.projects);
	const nextGlobal = {
		schemaVersion: input.document.schemaVersion,
		entries: next.globalEntries,
		...(input.document.globalEnabled === undefined ? {} : { globalEnabled: input.document.globalEnabled }),
	};
	if (globalChanged) await input.writeGlobal(nextGlobal);
	if (projectsChanged) {
		try {
			await input.writeProject({
				schemaVersion: input.projectDocument.schemaVersion,
				projects: next.projects,
				...(input.projectDocument.projectEnabled === undefined
					? {}
					: { projectEnabled: input.projectDocument.projectEnabled }),
			});
		} catch (error) {
			if (globalChanged) await input.writeGlobal(input.document);
			throw error;
		}
	}
	const globalAdded = next.added.filter((item) => memoryScopeOf(item.candidate) === "global");
	input.remember(
		globalAdded.map((item) => item.candidate),
		globalAdded.map((item) => item.entry),
	);
	const projectAdded = next.added.filter((item) => memoryScopeOf(item.candidate) === "project");
	input.remember(
		projectAdded.map((item) => item.candidate),
		projectAdded.map((item) => item.entry),
	);
	await input.commitCursor();
	input.forget();
	return [...next.globalEntries];
}

/** Applies reviewed candidates onto copies of the global list and project buckets. */
export function applyScopedMemorySave(input: {
	readonly globalEntries: readonly GlobalMemoryEntry[];
	readonly projects: readonly { readonly path: string; readonly entries: readonly GlobalMemoryEntry[] }[];
	readonly additions: readonly SaveMemoryCandidate[];
	readonly updates: ReadonlyMap<string, SaveMemoryCandidate>;
	readonly savedScopeByEntryId: ReadonlyMap<string, MemoryScope>;
	readonly projectPath: string;
	readonly recordedAt: string;
	readonly createId: () => string;
}): ScopedMemorySaveResult {
	const globalEntries = [...input.globalEntries];
	const projects: ProjectMemoryBucket[] = input.projects.map((project) => ({
		path: project.path,
		entries: [...project.entries],
	}));
	const added: { candidate: SaveMemoryCandidate; entry: GlobalMemoryEntry }[] = [];

	for (const [entryId, candidate] of input.updates) {
		const savedScope = input.savedScopeByEntryId.get(entryId);
		if (!savedScope) throw new Error("memory:store-rejected");
		const current = takeEntry(savedScope, entryId, globalEntries, projects);
		const next = { ...current, text: candidate.text, category: candidate.category };
		placeEntry(memoryScopeOf(candidate), next, input.projectPath, globalEntries, projects);
	}

	for (const candidate of input.additions) {
		const entry: GlobalMemoryEntry = {
			id: input.createId(),
			text: candidate.text,
			category: candidate.category,
			recordedAt: input.recordedAt,
		};
		placeEntry(memoryScopeOf(candidate), entry, input.projectPath, globalEntries, projects);
		added.push({ candidate, entry });
	}

	return {
		globalEntries,
		projects: projects.filter((project) => project.entries.length > 0),
		added,
	};
}

function takeEntry(
	scope: MemoryScope,
	entryId: string,
	globalEntries: GlobalMemoryEntry[],
	projects: ProjectMemoryBucket[],
): GlobalMemoryEntry {
	if (scope === "global") {
		const index = globalEntries.findIndex((entry) => entry.id === entryId);
		const entry = index < 0 ? undefined : globalEntries[index];
		if (!entry) throw new Error("memory:store-rejected");
		globalEntries.splice(index, 1);
		return entry;
	}
	for (const project of projects) {
		const index = project.entries.findIndex((entry) => entry.id === entryId);
		const entry = index < 0 ? undefined : project.entries[index];
		if (!entry) continue;
		project.entries.splice(index, 1);
		return entry;
	}
	throw new Error("memory:store-rejected");
}

function placeEntry(
	scope: MemoryScope,
	entry: GlobalMemoryEntry,
	projectPath: string,
	globalEntries: GlobalMemoryEntry[],
	projects: ProjectMemoryBucket[],
): void {
	if (scope === "global") {
		globalEntries.push(entry);
		return;
	}
	const bucket = projects.find((project) => project.path === projectPath);
	if (bucket) {
		bucket.entries.push(entry);
		return;
	}
	projects.push({ path: projectPath, entries: [entry] });
}
