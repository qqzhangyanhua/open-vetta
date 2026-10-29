import type { GlobalMemoryEntry, ProjectMemoryProject, UpdateMemoryEntry } from "@/shared/memory";

export function relocateMemoryEntry(
	entries: readonly GlobalMemoryEntry[],
	projects: readonly ProjectMemoryProject[],
	update: UpdateMemoryEntry,
): { entries: GlobalMemoryEntry[]; projects: ProjectMemoryProject[] } {
	const nextEntry = (entry: GlobalMemoryEntry): GlobalMemoryEntry => ({
		...entry,
		text: update.text,
		category: update.category,
	});
	if (update.scope === "global" && entries.some((entry) => entry.id === update.id)) {
		return {
			entries: entries.map((entry) => (entry.id === update.id ? nextEntry(entry) : entry)),
			projects: projects.map((project) => ({ ...project, entries: [...project.entries] })),
		};
	}
	const targetPath = update.projectPath;
	if (
		update.scope === "project" &&
		targetPath &&
		projects.some((project) => project.path === targetPath && project.entries.some((entry) => entry.id === update.id))
	) {
		return {
			entries: [...entries],
			projects: projects.map((project) =>
				project.path === targetPath
					? {
							...project,
							entries: project.entries.map((entry) => (entry.id === update.id ? nextEntry(entry) : entry)),
						}
					: project,
			),
		};
	}
	let found: GlobalMemoryEntry | undefined;
	const global = entries.filter((entry) => {
		if (entry.id !== update.id) return true;
		found = entry;
		return false;
	});
	const without = projects.map((project) => ({
		...project,
		entries: project.entries.filter((entry) => {
			if (entry.id !== update.id) return true;
			found = entry;
			return false;
		}),
	}));
	if (!found) return { entries: [...entries], projects: without };
	const moved = nextEntry(found);
	if (update.scope === "global") {
		return { entries: [...global, moved], projects: without.filter((project) => project.entries.length > 0) };
	}
	if (!targetPath) return { entries: [...entries], projects: without };
	let placed = false;
	const placedProjects = without.map((project) => {
		if (project.path !== targetPath) return project;
		placed = true;
		return { ...project, entries: [...project.entries, moved] };
	});
	if (!placed) placedProjects.push({ path: targetPath, kind: "local", entries: [moved] });
	return { entries: global, projects: placedProjects.filter((project) => project.entries.length > 0) };
}

export function removeMemoryEntry(
	entries: readonly GlobalMemoryEntry[],
	projects: readonly ProjectMemoryProject[],
	id: string,
): { entries: GlobalMemoryEntry[]; projects: ProjectMemoryProject[] } {
	return {
		entries: entries.filter((entry) => entry.id !== id),
		projects: projects
			.map((project) => ({ ...project, entries: project.entries.filter((entry) => entry.id !== id) }))
			.filter((project) => project.entries.length > 0),
	};
}
