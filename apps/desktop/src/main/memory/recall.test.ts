import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type GlobalMemoryEntry, MEMORY_SCOPE_CHAR_BUDGET, type MemoryCategory } from "../../shared/memory.js";
import { memoryProjectPath } from "./project-path.js";
import { type RecallScopeEntries, readRecallSnapshot, searchUnloadedMemories } from "./recall.js";
import { createCuratedRecallSessionExtensions, createRecallTool, validateRecallInput } from "./recall-tool.js";
import { globalMemoryFilePath, projectMemoryFilePath } from "./store.js";

function entry(id: string, text: string, category: MemoryCategory, recordedAt = "2026-10-28"): GlobalMemoryEntry {
	return { id, text, category, recordedAt };
}

describe("searchUnloadedMemories", () => {
	const scopes: readonly RecallScopeEntries[] = [
		{
			scope: "global",
			entries: [
				entry("g1", "Lives in Kunshan", "location", "2020-01-01"),
				entry("g2", "likes TEA", "preference", "2026-10-28"),
			],
			loadedIds: new Set(["g1"]),
		},
		{
			scope: "project",
			entries: [
				entry("p1", "tea in this repo", "work", "2024-01-01"),
				entry("p2", "loaded tea note", "work", "2026-10-29"),
			],
			loadedIds: new Set(["p2"]),
		},
	];

	it("matches unloaded fact text and keeps file order across scopes", () => {
		expect(searchUnloadedMemories(scopes, { keyword: " tea " })).toEqual([
			{ scope: "global", category: "preference", recordedAt: "2026-10-28", text: "likes TEA" },
			{ scope: "project", category: "work", recordedAt: "2024-01-01", text: "tea in this repo" },
		]);
	});

	it("filters by category or scope and skips a blank keyword", () => {
		expect(searchUnloadedMemories(scopes, { keyword: "tea", category: "work" })).toEqual([
			{ scope: "project", category: "work", recordedAt: "2024-01-01", text: "tea in this repo" },
		]);
		expect(searchUnloadedMemories(scopes, { keyword: "tea", scope: "global" })).toEqual([
			{ scope: "global", category: "preference", recordedAt: "2026-10-28", text: "likes TEA" },
		]);
		expect(searchUnloadedMemories(scopes, { keyword: "kunshan" })).toEqual([]);
		expect(searchUnloadedMemories(scopes, { keyword: "   " })).toEqual([]);
	});
});

describe("readRecallSnapshot", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	async function directory(): Promise<string> {
		const created = await mkdtemp(join(tmpdir(), "vetta-memory-recall-"));
		directories.push(created);
		return created;
	}

	it("returns only unloaded entries from open scopes of the current project", async () => {
		const dir = await directory();
		const projectA = join(dir, "project-a");
		const projectB = join(dir, "project-b");
		const pin = "住在昆山";
		const chunkLen = Math.min(2_000, MEMORY_SCOPE_CHAR_BUDGET - pin.length);
		const loaded = "n".repeat(chunkLen);
		const unloaded = `UNLOADED-${"o".repeat(chunkLen - "UNLOADED-".length)}`;
		const unloadedProject = `UNLOADED-${"p".repeat(chunkLen - "UNLOADED-".length)}`;
		await writeFile(
			globalMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				entries: [
					{ ...entry("11111111-1111-4111-8111-111111111111", pin, "location", "2020-01-01"), pinned: true },
					entry("22222222-2222-4222-8222-222222222222", loaded, "preference", "2026-10-28"),
					entry("33333333-3333-4333-8333-333333333333", unloaded, "interest", "2024-01-01"),
				],
			}),
		);
		await writeFile(
			projectMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				projects: [
					{
						path: memoryProjectPath(projectA),
						entries: [
							{
								...entry("44444444-4444-4444-8444-444444444444", "项目常驻", "work", "2020-01-01"),
								pinned: true,
							},
							entry("55555555-5555-4555-8555-555555555555", loaded, "work", "2026-10-28"),
							entry("66666666-6666-4666-8666-666666666666", unloadedProject, "other", "2024-01-01"),
						],
					},
					{
						path: memoryProjectPath(projectB),
						entries: [entry("77777777-7777-4777-8777-777777777777", "UNLOADED other project", "work")],
					},
				],
			}),
		);

		const snapshot = readRecallSnapshot({ directory: dir, cwd: projectA });
		expect(snapshot.visible).toBe(true);
		expect(snapshot.search({ keyword: "UNLOADED" })).toEqual([
			{ scope: "global", category: "interest", recordedAt: "2024-01-01", text: unloaded },
			{ scope: "project", category: "other", recordedAt: "2024-01-01", text: unloadedProject },
		]);
		expect(snapshot.search({ keyword: "UNLOADED", scope: "project", category: "other" })).toEqual([
			{ scope: "project", category: "other", recordedAt: "2024-01-01", text: unloadedProject },
		]);
	});

	it("hides a closed or unreadable scope and stays visible when a file is missing", async () => {
		const dir = await directory();
		const projectA = join(dir, "project-a");
		expect(readRecallSnapshot({ directory: dir, cwd: projectA }).visible).toBe(true);
		expect(readRecallSnapshot({ directory: dir, cwd: projectA }).search({ keyword: "tea" })).toEqual([]);

		const chunkLen = 2_000;
		const unloadedProject = `project tea ${"p".repeat(chunkLen - "project tea ".length)}`;
		await writeFile(globalMemoryFilePath(dir), "{not json");
		await writeFile(
			projectMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				projects: [
					{
						path: memoryProjectPath(projectA),
						entries: [
							{ ...entry("44444444-4444-4444-8444-444444444444", "常", "work", "2020-01-01"), pinned: true },
							entry("55555555-5555-4555-8555-555555555555", "n".repeat(chunkLen), "work", "2026-10-28"),
							entry("66666666-6666-4666-8666-666666666666", unloadedProject, "other", "2024-01-01"),
						],
					},
				],
			}),
		);
		const corruptGlobal = readRecallSnapshot({ directory: dir, cwd: projectA });
		expect(corruptGlobal.visible).toBe(true);
		expect(corruptGlobal.search({ keyword: "tea" })).toEqual([
			{ scope: "project", category: "other", recordedAt: "2024-01-01", text: unloadedProject },
		]);

		await writeFile(
			globalMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				globalEnabled: false,
				entries: [entry("11111111-1111-4111-8111-111111111111", "global tea", "preference")],
			}),
		);
		expect(readRecallSnapshot({ directory: dir, cwd: projectA }).search({ keyword: "tea" })).toEqual([
			{ scope: "project", category: "other", recordedAt: "2024-01-01", text: unloadedProject },
		]);

		await writeFile(
			projectMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				projectEnabled: false,
				projects: [
					{
						path: memoryProjectPath(projectA),
						entries: [entry("44444444-4444-4444-8444-444444444444", "project tea", "work")],
					},
				],
			}),
		);
		expect(readRecallSnapshot({ directory: dir, cwd: projectA }).visible).toBe(false);

		await writeFile(globalMemoryFilePath(dir), "{not json");
		expect(readRecallSnapshot({ directory: dir, cwd: projectA }).visible).toBe(false);
	});
});

describe("recall tool", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	it("rejects a write-shaped call and does not change the memory files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "vetta-memory-recall-tool-"));
		directories.push(dir);
		const projectA = join(dir, "project-a");
		const chunkLen = 2_000;
		const unloaded = `tea-${"o".repeat(chunkLen - "tea-".length)}`;
		await writeFile(
			globalMemoryFilePath(dir),
			JSON.stringify({
				schemaVersion: 1,
				entries: [
					{ ...entry("11111111-1111-4111-8111-111111111111", "常", "location", "2020-01-01"), pinned: true },
					entry("22222222-2222-4222-8222-222222222222", "n".repeat(chunkLen), "preference", "2026-10-28"),
					entry("33333333-3333-4333-8333-333333333333", unloaded, "interest", "2024-01-01"),
				],
			}),
		);
		const before = await readFile(globalMemoryFilePath(dir));
		const snapshot = readRecallSnapshot({ directory: dir, cwd: projectA });
		const tool = createRecallTool(snapshot);
		expect(tool.name).toBe("recall");
		expect(tool.name.includes("memory")).toBe(false);
		expect(JSON.stringify(tool.inputSchema)).toContain("keyword");
		expect(JSON.stringify(tool.inputSchema)).not.toContain('"action"');
		expect(() => validateRecallInput({ keyword: "   " })).toThrow("recall:invalid-keyword");
		expect(() => validateRecallInput({ keyword: "tea", category: "nope" })).toThrow("recall:invalid-category");
		expect(() => validateRecallInput({ keyword: "tea", scope: "other" })).toThrow("recall:invalid-scope");
		expect(validateRecallInput({ keyword: " tea " })).toEqual({ keyword: "tea" });

		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: validateRecallInput({ keyword: "TEA" }),
			signal: new AbortController().signal,
		});
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "")).toEqual([
			{ scope: "global", category: "interest", recordedAt: "2024-01-01", text: unloaded },
		]);
		expect(await readFile(globalMemoryFilePath(dir))).toEqual(before);
	});

	it("registers only for an interactive session that already has a working directory", () => {
		expect(createCuratedRecallSessionExtensions({ scenario: "conversation", cwd: "/tmp/project" })).toHaveLength(1);
		expect(createCuratedRecallSessionExtensions({ scenario: "project", cwd: "/tmp/project" })).toHaveLength(1);
		expect(createCuratedRecallSessionExtensions({ scenario: "batch", cwd: "/tmp/project" })).toEqual([]);
		expect(createCuratedRecallSessionExtensions({ scenario: "automation", cwd: "/tmp/project" })).toEqual([]);
		expect(
			createCuratedRecallSessionExtensions({
				scenario: "conversation",
				cwd: "/tmp/project",
				parentSessionPath: "/tmp/parent.jsonl",
			}),
		).toEqual([]);
		expect(createCuratedRecallSessionExtensions({ scenario: "conversation", cwd: "   " })).toEqual([]);
		expect(createCuratedRecallSessionExtensions({ scenario: "conversation" })).toEqual([]);
	});
});
