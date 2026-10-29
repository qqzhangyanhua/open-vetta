import {
	type GlobalMemoryEntry,
	MEMORY_CATEGORIES,
	MEMORY_SCOPE_CHAR_BUDGET,
	type MemoryCategory,
} from "../../shared/memory.js";

export interface MemoryCategoryCount {
	readonly category: MemoryCategory;
	readonly count: number;
}

export interface MemoryPromptSelection {
	readonly entries: readonly GlobalMemoryEntry[];
	/** Null when this scope fits. Counts every entry in the scope, including ones left out. */
	readonly catalog: readonly MemoryCategoryCount[] | null;
}

interface IndexedEntry {
	readonly entry: GlobalMemoryEntry;
	readonly index: number;
}

/** 同一天里后写入的在文件更靠后，视为更新。 */
function newerFirst(left: IndexedEntry, right: IndexedEntry): number {
	if (left.entry.recordedAt !== right.entry.recordedAt) {
		return left.entry.recordedAt < right.entry.recordedAt ? 1 : -1;
	}
	return right.index - left.index;
}

function categoryCatalog(entries: readonly GlobalMemoryEntry[]): readonly MemoryCategoryCount[] {
	const counts = new Map<MemoryCategory, number>();
	for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
	return MEMORY_CATEGORIES.flatMap((category) => {
		const count = counts.get(category) ?? 0;
		return count > 0 ? [{ category, count }] : [];
	});
}

/**
 * One scope at a time. Callers pass global and project separately so neither budget shrinks the other.
 * 常驻合计可以超过预算。丢掉常驻去守住数字，会把记得早但仍有用的事实挤掉，所以常驻一律保留。
 * 其余按日期从新到旧，下一条放不下就停，不用更旧的条目换掉更近的那条。
 */
export function selectMemoryForPrompt(entries: readonly GlobalMemoryEntry[]): MemoryPromptSelection {
	let total = 0;
	for (const entry of entries) total += entry.text.length;
	if (total <= MEMORY_SCOPE_CHAR_BUDGET) return { entries, catalog: null };

	const indexed = entries.map((entry, index) => ({ entry, index }));
	const pinned = indexed.filter((item) => item.entry.pinned === true).sort(newerFirst);
	const unpinned = indexed.filter((item) => item.entry.pinned !== true).sort(newerFirst);
	let remaining = MEMORY_SCOPE_CHAR_BUDGET;
	for (const item of pinned) remaining -= item.entry.text.length;
	const selected = pinned.map((item) => item.entry);
	for (const item of unpinned) {
		if (item.entry.text.length > remaining) break;
		selected.push(item.entry);
		remaining -= item.entry.text.length;
	}
	return { entries: selected, catalog: categoryCatalog(entries) };
}
