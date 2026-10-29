import {
	type GlobalMemoryEntry,
	MEMORY_CATEGORIES,
	MEMORY_SCOPES,
	type MemoryCategory,
	type MemoryScope,
} from "../../shared/memory.js";
import { memoryProjectPath } from "./project-path.js";
import { isGlobalMemoryReadEnabled, isProjectMemoryReadEnabled } from "./schema.js";
import { selectMemoryForPrompt } from "./select.js";
import { createGlobalMemoryStore, createProjectMemoryStore } from "./store.js";

/** 不能叫 memory，否则会和 memory-mode 的可写工具重名。 */
export const RECALL_TOOL_NAME = "recall";

export interface RecallQuery extends Readonly<Record<string, unknown>> {
	readonly keyword: string;
	readonly category?: MemoryCategory;
	readonly scope?: MemoryScope;
}

export interface RecallHit {
	readonly scope: MemoryScope;
	readonly category: MemoryCategory;
	readonly recordedAt: string;
	readonly text: string;
}

export interface RecallScopeEntries {
	readonly scope: MemoryScope;
	readonly entries: readonly GlobalMemoryEntry[];
	readonly loadedIds: ReadonlySet<string>;
}

export interface RecallSnapshot {
	/** 至少一个开关打开且对应文件能读出来。缺文件按开关默认打开。 */
	readonly visible: boolean;
	search(query: RecallQuery): readonly RecallHit[];
}

/** 只查没进提示词的条目。已加载的、关掉的范围、别的项目都不在 scopes 里。 */
export function searchUnloadedMemories(
	scopes: readonly RecallScopeEntries[],
	query: RecallQuery,
): readonly RecallHit[] {
	const keyword = query.keyword.trim().toLowerCase();
	if (!keyword) return [];
	const hits: RecallHit[] = [];
	for (const scope of scopes) {
		if (query.scope !== undefined && scope.scope !== query.scope) continue;
		for (const entry of scope.entries) {
			if (scope.loadedIds.has(entry.id)) continue;
			if (query.category !== undefined && entry.category !== query.category) continue;
			if (!entry.text.toLowerCase().includes(keyword)) continue;
			hits.push({
				scope: scope.scope,
				category: entry.category,
				recordedAt: entry.recordedAt,
				text: entry.text,
			});
		}
	}
	return hits;
}

/**
 * 读失败的范围当作没打开：坏文件不能让这一轮对话失败，也不能被搜到。
 * 缺文件仍是打开，和提示词注入同一规则。
 */
export function readRecallSnapshot(input: { readonly directory: string; readonly cwd: string }): RecallSnapshot {
	const scopes: RecallScopeEntries[] = [];
	const global = readGlobalScope(input.directory);
	if (global) scopes.push(global);
	const project = readProjectScope(input.directory, input.cwd);
	if (project) scopes.push(project);
	return {
		visible: scopes.length > 0,
		search: (query) => searchUnloadedMemories(scopes, query),
	};
}

export function isRecallCategory(value: string): value is MemoryCategory {
	return (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

export function isRecallScope(value: string): value is MemoryScope {
	return (MEMORY_SCOPES as readonly string[]).includes(value);
}

function readGlobalScope(directory: string): RecallScopeEntries | undefined {
	try {
		const document = createGlobalMemoryStore(directory).readSync();
		if (!isGlobalMemoryReadEnabled(document)) return undefined;
		return toScope("global", document.entries);
	} catch {
		return undefined;
	}
}

function readProjectScope(directory: string, cwd: string): RecallScopeEntries | undefined {
	let projectPath: string;
	try {
		projectPath = memoryProjectPath(cwd);
	} catch {
		return undefined;
	}
	try {
		const document = createProjectMemoryStore(directory).readSync();
		if (!isProjectMemoryReadEnabled(document)) return undefined;
		const entries = document.projects.find((project) => project.path === projectPath)?.entries ?? [];
		return toScope("project", entries);
	} catch {
		return undefined;
	}
}

function toScope(scope: MemoryScope, entries: readonly GlobalMemoryEntry[]): RecallScopeEntries {
	const loaded = selectMemoryForPrompt(entries);
	return {
		scope,
		entries,
		loadedIds: new Set(loaded.entries.map((entry) => entry.id)),
	};
}
