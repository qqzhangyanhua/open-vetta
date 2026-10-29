import { sameProjectLocation } from "@vetta/ssh-transport";
import type { GlobalMemoryEntry, MemoryKnownProject, ProjectMemoryProject } from "../../shared/memory.js";
import { memoryProjectPath } from "./project-path.js";
import { type ProjectMemoryRecord, projectMemoryKindOf } from "./schema.js";

/** 没有项目列表时不要猜成空列表，否则还在用的记忆会被标成可删除。 */
export function projectMemoryViews(
	projects: readonly ProjectMemoryRecord[],
	known: readonly string[] | null,
	conversationRoot: string,
): ProjectMemoryProject[] {
	const listed = known === null ? null : canonicalMemoryProjectPaths(known);
	return projects
		.filter((project) => project.entries.length > 0)
		.map((project) => ({
			path: project.path,
			kind: projectMemoryKindOf(project.path, conversationRoot),
			entries: [...project.entries],
			orphaned: listed !== null && !listed.some((item) => matches(item, project.path)),
		}));
}

export function knownProjectViews(paths: readonly string[], conversationRoot: string): MemoryKnownProject[] {
	return canonicalMemoryProjectPaths(paths).map((path) => ({
		path,
		kind: projectMemoryKindOf(path, conversationRoot),
	}));
}

export function canonicalMemoryProjectPaths(paths: readonly string[]): string[] {
	const canonical: string[] = [];
	for (const path of paths) {
		let next: string;
		try {
			next = memoryProjectPath(path);
		} catch {
			continue;
		}
		if (canonical.some((item) => matches(item, next))) continue;
		canonical.push(next);
	}
	return canonical;
}

export function deleteOrphanedProjectEntries(
	projects: readonly ProjectMemoryRecord[],
	path: string,
	entryId: string | undefined,
	knownPaths: readonly string[],
): ProjectMemoryRecord[] {
	const source = requireOrphan(projects, path, knownPaths);
	if (entryId === undefined) return projects.filter((project) => project !== source);
	const removed = entriesToMove(source, entryId);
	const remaining = source.entries.filter((entry) => !removed.some((item) => item.id === entry.id));
	if (remaining.length === 0) return projects.filter((project) => project !== source);
	return projects.map((project) => (project === source ? { path: project.path, entries: remaining } : project));
}

export function reattachOrphanedProjectEntries(
	projects: readonly ProjectMemoryRecord[],
	path: string,
	targetPath: string,
	entryId: string | undefined,
	knownPaths: readonly string[],
): ProjectMemoryRecord[] {
	const source = requireOrphan(projects, path, knownPaths);
	const target = canonicalTarget(targetPath, knownPaths, source.path);
	const moving = entriesToMove(source, entryId);
	const remaining = entryId === undefined ? [] : source.entries.filter((entry) => entry.id !== entryId);
	let placed = false;
	const next: ProjectMemoryRecord[] = [];
	for (const project of projects) {
		if (project === source) {
			if (remaining.length > 0) next.push({ path: source.path, entries: remaining });
			continue;
		}
		if (!placed && matches(project.path, target)) {
			next.push({ path: target, entries: mergeEntries(project.entries, moving) });
			placed = true;
			continue;
		}
		next.push(project);
	}
	if (!placed) next.push({ path: target, entries: mergeEntries([], moving) });
	return next;
}

function requireOrphan(
	projects: readonly ProjectMemoryRecord[],
	path: string,
	knownPaths: readonly string[],
): ProjectMemoryRecord {
	const source = locateProject(projects, path);
	if (!source) throw new Error("memory:store-rejected");
	if (isListed(source.path, knownPaths)) throw new Error("memory:not-orphaned");
	return source;
}

function canonicalTarget(targetPath: string, knownPaths: readonly string[], sourcePath: string): string {
	let target: string;
	try {
		target = memoryProjectPath(targetPath);
	} catch {
		throw new Error("memory:invalid-target");
	}
	if (!isListed(target, knownPaths) || matches(sourcePath, target)) throw new Error("memory:invalid-target");
	return target;
}

function locateProject(projects: readonly ProjectMemoryRecord[], path: string): ProjectMemoryRecord | undefined {
	const exact = projects.find((project) => project.path === path);
	if (exact) return exact;
	let canonical: string;
	try {
		canonical = memoryProjectPath(path);
	} catch (error) {
		if (error instanceof Error && error.message === "memory:project-unavailable") throw error;
		throw new Error("memory:store-rejected");
	}
	return (
		projects.find((project) => project.path === canonical) ??
		projects.find((project) => matches(project.path, canonical))
	);
}

function isListed(path: string, knownPaths: readonly string[]): boolean {
	return canonicalMemoryProjectPaths(knownPaths).some((item) => matches(item, path));
}

function entriesToMove(source: ProjectMemoryRecord, entryId: string | undefined): readonly GlobalMemoryEntry[] {
	if (entryId === undefined) return source.entries;
	const found = source.entries.filter((entry) => entry.id === entryId);
	if (found.length === 0) throw new Error("memory:store-rejected");
	return found;
}

function mergeEntries(
	existing: readonly GlobalMemoryEntry[],
	moving: readonly GlobalMemoryEntry[],
): GlobalMemoryEntry[] {
	const ids = new Set(existing.map((entry) => entry.id));
	return [...existing, ...moving.filter((entry) => !ids.has(entry.id))];
}

function matches(left: string, right: string): boolean {
	if (left === right) return true;
	try {
		return sameProjectLocation(left, right);
	} catch {
		return false;
	}
}
