import type { GlobalMemoryEntry, MemoryScope, UpdateMemoryEntry } from "../../shared/memory.js";
import { containsCredential } from "./parse.js";
import {
	emptyGlobalMemoryDocument,
	emptyProjectMemoryDocument,
	type GlobalMemoryDocument,
	type ProjectMemoryDocument,
	parseDeleteMemoryEntryId,
	parseUpdateMemoryEntry,
} from "./schema.js";

export interface MemoryDocumentAccess {
	readGlobal(): Promise<GlobalMemoryDocument>;
	readProject(): Promise<ProjectMemoryDocument>;
	writeGlobal(document: GlobalMemoryDocument): Promise<void>;
	writeProject(document: ProjectMemoryDocument): Promise<void>;
}

interface MemoryDocumentBodies {
	readonly globalEntries: readonly GlobalMemoryEntry[];
	readonly projects: readonly { readonly path: string; readonly entries: readonly GlobalMemoryEntry[] }[];
}

interface TakenMemoryEntry {
	readonly entry: GlobalMemoryEntry;
	readonly scope: MemoryScope;
	readonly projectPath?: string;
	readonly index: number;
}

interface MutableProjectBucket {
	path: string;
	entries: GlobalMemoryEntry[];
}

type Loaded<T> = { readonly ok: true; readonly document: T } | { readonly ok: false; readonly error: unknown };

export async function updateStoredMemoryEntry(access: MemoryDocumentAccess, input: UpdateMemoryEntry): Promise<void> {
	const parsed = parseUpdateMemoryEntry(input);
	if (containsCredential(parsed.text)) throw new Error("memory:invalid-entry");
	const global = await loadDocument(() => access.readGlobal());
	const project = await loadDocument(() => access.readProject());
	if (global.ok && project.ok) {
		const next = applyMemoryEntryUpdate(global.document, project.document, parsed);
		await commitMemoryDocuments(access, global.document, project.document, next);
		return;
	}
	// The other file stays as it is unless this edit has to write it.
	if (global.ok && !project.ok) {
		const error = asStoreError(project.error);
		assertReadableUpdate(parsed, global.document.entries, [], error, "global");
		const next = applyMemoryEntryUpdate(global.document, emptyProjectMemoryDocument(), parsed);
		await commitMemoryDocuments(access, global.document, emptyProjectMemoryDocument(), next);
		return;
	}
	if (!global.ok && project.ok) {
		const error = asStoreError(global.error);
		assertReadableUpdate(parsed, [], project.document.projects, error, "project");
		const next = applyMemoryEntryUpdate(emptyGlobalMemoryDocument(), project.document, parsed);
		await commitMemoryDocuments(access, emptyGlobalMemoryDocument(), project.document, next);
		return;
	}
	throw unreadableError(global);
}

export async function deleteStoredMemoryEntry(access: MemoryDocumentAccess, id: string): Promise<void> {
	const parsedId = parseDeleteMemoryEntryId(id);
	const global = await loadDocument(() => access.readGlobal());
	const project = await loadDocument(() => access.readProject());
	if (global.ok && project.ok) {
		const next = applyMemoryEntryDelete(global.document, project.document, parsedId);
		await commitMemoryDocuments(access, global.document, project.document, next);
		return;
	}
	if (global.ok && !project.ok) {
		assertReadableDelete(parsedId, global.document.entries, [], asStoreError(project.error));
		const next = applyMemoryEntryDelete(global.document, emptyProjectMemoryDocument(), parsedId);
		await commitMemoryDocuments(access, global.document, emptyProjectMemoryDocument(), next);
		return;
	}
	if (!global.ok && project.ok) {
		assertReadableDelete(parsedId, [], project.document.projects, asStoreError(global.error));
		const next = applyMemoryEntryDelete(emptyGlobalMemoryDocument(), project.document, parsedId);
		await commitMemoryDocuments(access, emptyGlobalMemoryDocument(), project.document, next);
		return;
	}
	throw unreadableError(global);
}

async function loadDocument<T>(read: () => Promise<T>): Promise<Loaded<T>> {
	try {
		return { ok: true, document: await read() };
	} catch (error) {
		return { ok: false, error };
	}
}

function asStoreError(error: unknown): Error {
	return error instanceof Error ? error : new Error("memory:store-rejected");
}

function unreadableError(loaded: Loaded<unknown>): Error {
	if (!loaded.ok) return asStoreError(loaded.error);
	return new Error("memory:store-rejected");
}

function assertReadableUpdate(
	update: UpdateMemoryEntry,
	globalEntries: readonly GlobalMemoryEntry[],
	projects: readonly { readonly path: string; readonly entries: readonly GlobalMemoryEntry[] }[],
	siblingError: Error,
	readableScope: MemoryScope,
): void {
	const hits = memoryEntryHits(update.id, globalEntries, projects);
	if (hits.length > 1) throw new Error("memory:store-rejected");
	if (hits.length !== 1 || update.scope !== readableScope) throw siblingError;
}

function assertReadableDelete(
	id: string,
	globalEntries: readonly GlobalMemoryEntry[],
	projects: readonly { readonly path: string; readonly entries: readonly GlobalMemoryEntry[] }[],
	siblingError: Error,
): void {
	const hits = memoryEntryHits(id, globalEntries, projects);
	if (hits.length > 1) throw new Error("memory:store-rejected");
	if (hits.length !== 1) throw siblingError;
}

function applyMemoryEntryUpdate(
	globalDocument: GlobalMemoryDocument,
	projectDocument: ProjectMemoryDocument,
	update: UpdateMemoryEntry,
): MemoryDocumentBodies {
	const { globalEntries, projects } = copyMemoryBodies(globalDocument, projectDocument);
	const taken = takeMemoryEntry(update.id, globalEntries, projects);
	placeMemoryEntry(
		{ ...taken.entry, text: update.text, category: update.category },
		update.scope,
		update.projectPath,
		taken,
		globalEntries,
		projects,
	);
	return { globalEntries, projects: projects.filter((project) => project.entries.length > 0) };
}

function applyMemoryEntryDelete(
	globalDocument: GlobalMemoryDocument,
	projectDocument: ProjectMemoryDocument,
	id: string,
): MemoryDocumentBodies {
	const { globalEntries, projects } = copyMemoryBodies(globalDocument, projectDocument);
	takeMemoryEntry(id, globalEntries, projects);
	return { globalEntries, projects: projects.filter((project) => project.entries.length > 0) };
}

/**
 * Writes global, then project. If the project write fails, the global file is put back
 * so a failed edit did not keep either side.
 */
async function commitMemoryDocuments(
	access: MemoryDocumentAccess,
	previousGlobal: GlobalMemoryDocument,
	previousProject: ProjectMemoryDocument,
	next: MemoryDocumentBodies,
): Promise<void> {
	const globalChanged = JSON.stringify(previousGlobal.entries) !== JSON.stringify(next.globalEntries);
	const projectsChanged = JSON.stringify(previousProject.projects) !== JSON.stringify(next.projects);
	if (!globalChanged && !projectsChanged) return;
	const nextGlobal: GlobalMemoryDocument = {
		schemaVersion: previousGlobal.schemaVersion,
		entries: next.globalEntries,
		...(previousGlobal.globalEnabled === undefined ? {} : { globalEnabled: previousGlobal.globalEnabled }),
	};
	const nextProject: ProjectMemoryDocument = {
		schemaVersion: previousProject.schemaVersion,
		projects: next.projects,
		...(previousProject.projectEnabled === undefined ? {} : { projectEnabled: previousProject.projectEnabled }),
	};
	if (globalChanged) await access.writeGlobal(nextGlobal);
	if (!projectsChanged) return;
	try {
		await access.writeProject(nextProject);
	} catch (error) {
		if (globalChanged) await access.writeGlobal(previousGlobal);
		throw error;
	}
}

function copyMemoryBodies(
	globalDocument: GlobalMemoryDocument,
	projectDocument: ProjectMemoryDocument,
): { globalEntries: GlobalMemoryEntry[]; projects: MutableProjectBucket[] } {
	return {
		globalEntries: [...globalDocument.entries],
		projects: projectDocument.projects.map((project) => ({
			path: project.path,
			entries: [...project.entries],
		})),
	};
}

function memoryEntryHits(
	id: string,
	globalEntries: readonly GlobalMemoryEntry[],
	projects: readonly { readonly path: string; readonly entries: readonly GlobalMemoryEntry[] }[],
): TakenMemoryEntry[] {
	const hits: TakenMemoryEntry[] = [];
	globalEntries.forEach((entry, index) => {
		if (entry.id === id) hits.push({ entry, scope: "global", index });
	});
	for (const project of projects) {
		project.entries.forEach((entry, index) => {
			if (entry.id === id) hits.push({ entry, scope: "project", projectPath: project.path, index });
		});
	}
	return hits;
}

function takeMemoryEntry(
	id: string,
	globalEntries: GlobalMemoryEntry[],
	projects: MutableProjectBucket[],
): TakenMemoryEntry {
	const hits = memoryEntryHits(id, globalEntries, projects);
	const hit = hits[0];
	if (!hit || hits.length !== 1) {
		throw new Error(hits.length === 0 ? "memory:entry-not-found" : "memory:store-rejected");
	}
	if (hit.scope === "global") {
		globalEntries.splice(hit.index, 1);
		return hit;
	}
	const project = projects.find((item) => item.path === hit.projectPath);
	project?.entries.splice(hit.index, 1);
	return hit;
}

function placeMemoryEntry(
	entry: GlobalMemoryEntry,
	scope: MemoryScope,
	projectPath: string | undefined,
	from: TakenMemoryEntry,
	globalEntries: GlobalMemoryEntry[],
	projects: MutableProjectBucket[],
): void {
	if (scope === "global") {
		if (from.scope === "global") globalEntries.splice(from.index, 0, entry);
		else globalEntries.push(entry);
		return;
	}
	if (!projectPath) throw new Error("memory:invalid-entry");
	const sameProject = from.scope === "project" && from.projectPath === projectPath;
	const existing = projects.find((project) => project.path === projectPath);
	const bucket = existing ?? { path: projectPath, entries: [] };
	if (!existing) projects.push(bucket);
	if (sameProject) bucket.entries.splice(from.index, 0, entry);
	else bucket.entries.push(entry);
}
