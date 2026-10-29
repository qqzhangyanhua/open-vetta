import { describe, expect, it } from "vitest";
import {
	type GlobalMemoryEntry,
	MEMORY_SCOPE_CHAR_BUDGET,
	type MemoryCategory,
	memoryEntryWithPinned,
} from "../../shared/memory.js";
import { selectMemoryForPrompt } from "./select.js";

function entry(input: {
	readonly id: string;
	readonly text: string;
	readonly category?: MemoryCategory;
	readonly recordedAt?: string;
	readonly pinned?: boolean;
}): GlobalMemoryEntry {
	return {
		id: input.id,
		text: input.text,
		category: input.category ?? "other",
		recordedAt: input.recordedAt ?? "2026-10-28",
		...(input.pinned ? { pinned: true } : {}),
	};
}

describe("selectMemoryForPrompt", () => {
	it("records a 4000-character budget for each scope", () => {
		expect(MEMORY_SCOPE_CHAR_BUDGET).toBe(4_000);
		const full = entry({ id: "a", text: "a".repeat(MEMORY_SCOPE_CHAR_BUDGET) });
		expect(selectMemoryForPrompt([full])).toEqual({ entries: [full], catalog: null });
		const over = entry({ id: "b", text: "b".repeat(MEMORY_SCOPE_CHAR_BUDGET + 1), category: "work" });
		expect(selectMemoryForPrompt([over])).toEqual({
			entries: [],
			catalog: [{ category: "work", count: 1 }],
		});
	});

	it("loads every entry in file order while the scope is within budget", () => {
		const older = entry({ id: "old", text: "a".repeat(2_000), recordedAt: "2020-01-01", category: "location" });
		const newer = entry({ id: "new", text: "b".repeat(2_000), recordedAt: "2026-10-28", category: "preference" });
		expect(selectMemoryForPrompt([older, newer])).toEqual({ entries: [older, newer], catalog: null });
	});

	it("keeps every pin, then fills from newest, and counts entries that were left out", () => {
		const pin = entry({
			id: "pin",
			text: "p".repeat(4),
			recordedAt: "2020-01-01",
			category: "location",
			pinned: true,
		});
		const newest = entry({
			id: "new",
			text: "n".repeat(MEMORY_SCOPE_CHAR_BUDGET - pin.text.length),
			recordedAt: "2026-10-28",
			category: "preference",
		});
		const dropped = entry({ id: "old", text: "dropped", recordedAt: "2024-06-01", category: "interest" });
		const selected = selectMemoryForPrompt([dropped, pin, newest]);
		expect(selected.entries).toEqual([pin, newest]);
		expect(selected.catalog).toEqual([
			{ category: "location", count: 1 },
			{ category: "preference", count: 1 },
			{ category: "interest", count: 1 },
		]);
	});

	it("still loads every pin when pinned text alone is over budget", () => {
		const pins = ["2020-01-01", "2024-01-01", "2026-01-01"].map((recordedAt, index) =>
			entry({
				id: `pin-${index}`,
				text: "p".repeat(2_000),
				recordedAt,
				category: "location",
				pinned: true,
			}),
		);
		const loose = entry({ id: "loose", text: "not loaded", category: "interest" });
		const selected = selectMemoryForPrompt([...pins, loose]);
		expect(selected.entries.map((item) => item.id)).toEqual(["pin-2", "pin-1", "pin-0"]);
		expect(selected.catalog).toEqual([
			{ category: "location", count: 3 },
			{ category: "interest", count: 1 },
		]);
	});

	it("stops at the first unpinned entry that does not fit instead of skipping to an older one", () => {
		const pin = entry({ id: "pin", text: "p".repeat(1_500), recordedAt: "2020-01-01", pinned: true });
		const newest = entry({ id: "new", text: "n".repeat(2_000), recordedAt: "2026-10-28" });
		const blocked = entry({ id: "mid", text: "m".repeat(600), recordedAt: "2026-06-01" });
		const olderShort = entry({ id: "old", text: "o".repeat(100), recordedAt: "2024-01-01" });
		expect(selectMemoryForPrompt([olderShort, blocked, pin, newest]).entries.map((item) => item.id)).toEqual([
			"pin",
			"new",
		]);
	});

	it("treats a later entry on the same day as newer", () => {
		const earlier = entry({ id: "earlier", text: "a".repeat(2_000) });
		const later = entry({ id: "later", text: "b".repeat(2_000) });
		const previousDay = entry({ id: "previous", text: "c".repeat(2_000), recordedAt: "2026-10-27" });
		expect(selectMemoryForPrompt([earlier, later, previousDay]).entries.map((item) => item.id)).toEqual([
			"later",
			"earlier",
		]);
	});

	it("does not let one scope's overflow reduce another scope's budget", () => {
		const over = [
			entry({ id: "pin", text: "p".repeat(4), recordedAt: "2020-01-01", pinned: true }),
			entry({ id: "new", text: "n".repeat(MEMORY_SCOPE_CHAR_BUDGET - 4) }),
			entry({ id: "drop", text: "dropped", recordedAt: "2024-01-01" }),
		];
		const global = selectMemoryForPrompt(over);
		const project = selectMemoryForPrompt(over.map((item) => ({ ...item, id: `project-${item.id}` })));
		expect(global.entries).toHaveLength(2);
		expect(project.entries).toHaveLength(2);
		expect(project.entries.map((item) => item.id)).toEqual(["project-pin", "project-new"]);
	});

	it("only treats pinned true as pinned", () => {
		const stored = entry({ id: "fact", text: "住在昆山" });
		expect(memoryEntryWithPinned(stored, false)).toBe(stored);
		const pinned = memoryEntryWithPinned(stored, true);
		expect(pinned.pinned).toBe(true);
		expect(memoryEntryWithPinned(pinned, true)).toBe(pinned);
		expect(memoryEntryWithPinned(pinned, false)).toEqual(stored);
		expect(
			selectMemoryForPrompt([{ ...stored, pinned: false }, entry({ id: "other", text: "x" })]).catalog,
		).toBeNull();
	});
});
