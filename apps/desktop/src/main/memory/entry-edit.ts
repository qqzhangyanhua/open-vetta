import type { GlobalMemoryEntry, MemoryScope, UpdateMemoryEntry } from "../../shared/memory.js";
import { containsCredential } from "./parse.js";
import {
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

export async function updateStoredMemoryEntry(access: MemoryDocumentAccess, input: UpdateMemoryEntry): Promise<void> {
	const parsed = parseUpdateMemoryEntry(input);
	if (containsCredential(parsed.text)) throw new Error("memory:invalid-entry");
	const globalDocument = await access.readGlobal();
	const projectDocument = await access.readProject();
	const next = applyMemoryEntryUpdate(globalDocument, projectDocument, parsed);
	await commitMemoryDocuments(access, globalDocument, projectDocument, next);
}

export async function deleteStoredMemoryEntry(access: MemoryDocumentAccess, id: string): Promise<void> {
	const parsedId = parseDeleteMemoryEntryId(id);
	const globalDocument = await access.readGlobal();
	const projectDocument = await access.readProject();
	const next = applyMemoryEntryDelete(globalDocument, projectDocument, parsedId);
	await commitMemoryDocuments(access, globalDocument, projectDocument, next);
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

function takeMemoryEntry(
	id: string,
	globalEntries: GlobalMemoryEntry[],
	projects: MutableProjectBucket[],
): TakenMemoryEntry {
	const hits: TakenMemoryEntry[] = [];
	globalEntries.forEach((entry, index) => {
		if (entry.id === id) hits.push({ entry, scope: "global", index });
	});
	for (const project of projects) {
		project.entries.forEach((entry, index) => {
			if (entry.id === id) hits.push({ entry, scope: "project", projectPath: project.path, index });
		});
	}
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
