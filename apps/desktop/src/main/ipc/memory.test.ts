import type { IpcRenderer } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "../../preload/apis/memory.js";
import type { GenerateGlobalMemoryResult, GlobalMemoryEntry, MemoryModelChoice } from "../../shared/memory.js";
import { type MemoryIpcService, registerMemoryIpc } from "./memory.js";

const bridge = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
			bridge.handlers.set(channel, handler),
		removeHandler: (channel: string) => bridge.handlers.delete(channel),
	},
}));

describe("memory preload/main contract", () => {
	let teardown: (() => void) | undefined;
	afterEach(() => {
		teardown?.();
		bridge.handlers.clear();
	});

	function install(service: MemoryIpcService) {
		teardown = registerMemoryIpc(service);
		return createMemoryApi({
			invoke: async (channel: string, ...args: unknown[]) => bridge.handlers.get(channel)?.({}, ...args),
		} as unknown as IpcRenderer).memory;
	}

	function serviceWith(
		overrides: Partial<MemoryIpcService> & Pick<MemoryIpcService, "listGlobal" | "generate" | "save">,
	): MemoryIpcService {
		return {
			getReadEnabled: vi.fn(async () => true),
			setReadEnabled: vi.fn(async (enabled: boolean) => enabled),
			getProjectReadEnabled: vi.fn(async () => true),
			setProjectReadEnabled: vi.fn(async (enabled: boolean) => enabled),
			listProjects: vi.fn(async () => []),
			getModelOverride: vi.fn(async () => null),
			setModelOverride: vi.fn(async () => undefined),
			listModels: vi.fn(async () => [] as MemoryModelChoice[]),
			listKnownProjects: vi.fn(async () => []),
			deleteOrphanedProjectMemory: vi.fn(async () => []),
			reattachOrphanedProjectMemory: vi.fn(async () => []),
			...overrides,
		};
	}

	it("forwards a valid generate and save, and rejects invalid payloads before the service", async () => {
		const saved: GlobalMemoryEntry[] = [
			{
				id: "11111111-1111-4111-8111-111111111111",
				text: "住在昆山",
				category: "location",
				recordedAt: "2026-10-28",
			},
		];
		const generated: GenerateGlobalMemoryResult = {
			status: "candidates",
			candidates: [
				{ id: "22222222-2222-4222-8222-222222222222", text: "住在昆山", category: "location", scope: "global" },
			],
		};
		const setModelOverride = vi.fn(async (modelKey: string | null) => {
			if (modelKey === "not-a-model") throw new Error("memory:invalid-model");
		});
		const service = serviceWith({
			listGlobal: vi.fn(async () => saved),
			generate: vi.fn(async () => generated),
			save: vi.fn(async () => saved),
			getModelOverride: vi.fn(async () => null),
			setModelOverride,
			listModels: vi.fn(
				async () => [{ modelKey: "openai/memory-model", label: "Memory Model" }] as MemoryModelChoice[],
			),
		});
		const api = install(service);

		expect(await api.listGlobal()).toEqual(saved);
		expect(await api.generate("runtime-1")).toEqual(generated);
		expect(service.generate).toHaveBeenCalledWith("runtime-1");
		await expect(api.generate("   ")).rejects.toThrow();
		await expect(api.generate("x".repeat(257))).rejects.toThrow();
		expect(service.generate).toHaveBeenCalledTimes(1);

		expect(await api.save([{ text: "住在昆山", category: "location" }])).toEqual(saved);
		expect(service.save).toHaveBeenCalledWith([{ text: "住在昆山", category: "location" }]);
		expect(await api.listProjects()).toEqual([]);
		expect(await api.getProjectReadEnabled()).toBe(true);
		expect(await api.setProjectReadEnabled(false)).toBe(false);
		expect(service.setProjectReadEnabled).toHaveBeenCalledWith(false);
		expect(await api.save([{ text: "这个仓库用 bun", category: "work", scope: "project" }])).toEqual(saved);
		expect(service.save).toHaveBeenCalledWith([{ text: "这个仓库用 bun", category: "work", scope: "project" }]);
		const saveUnknown = api.save as (value: unknown) => Promise<GlobalMemoryEntry[]>;
		await expect(saveUnknown([{ text: "这个仓库用 bun", category: "work", scope: "workspace" }])).rejects.toThrow(
			"memory:invalid-candidates",
		);
		await expect(api.save([{ text: "  ", category: "location" }])).rejects.toThrow("memory:invalid-candidates");
		await expect(saveUnknown([{ text: "住在昆山", category: "project" }])).rejects.toThrow(
			"memory:invalid-candidates",
		);
		expect(service.save).toHaveBeenCalledTimes(2);

		expect(await api.getModelOverride()).toBeNull();
		expect(await api.listModels()).toEqual([{ modelKey: "openai/memory-model", label: "Memory Model" }]);
		await expect(api.setModelOverride("not-a-model")).rejects.toThrow("memory:invalid-model");
		await api.setModelOverride(null);
		expect(setModelOverride).toHaveBeenLastCalledWith(null);
		await expect(api.setModelOverride(1 as unknown as string)).rejects.toThrow("memory:invalid-model");
		expect(setModelOverride).toHaveBeenCalledTimes(2);

		teardown?.();
		expect(bridge.handlers.size).toBe(0);
	});

	it("forwards the read switch and rejects a non-boolean before the service", async () => {
		const service = serviceWith({
			listGlobal: vi.fn(async () => []),
			generate: vi.fn(),
			save: vi.fn(),
			getReadEnabled: vi.fn(async () => true),
			setReadEnabled: vi.fn(async (enabled: boolean) => enabled),
		});
		const api = install(service);
		expect(await api.getReadEnabled()).toBe(true);
		expect(await api.setReadEnabled(false)).toBe(false);
		expect(service.setReadEnabled).toHaveBeenCalledWith(false);
		await expect(api.setReadEnabled("no" as unknown as boolean)).rejects.toThrow();
		expect(service.setReadEnabled).toHaveBeenCalledTimes(1);
	});

	it("forwards orphan delete and reattach, and rejects a bad payload before the service", async () => {
		const projects = [
			{
				path: "/tmp/gone",
				kind: "local" as const,
				orphaned: true,
				entries: [],
			},
		];
		const deleteOrphanedProjectMemory = vi.fn(async () => projects);
		const reattachOrphanedProjectMemory = vi.fn(async () => projects);
		const listKnownProjects = vi.fn(async () => [{ path: "/tmp/live", kind: "local" as const }]);
		const service = serviceWith({
			listGlobal: vi.fn(async () => []),
			generate: vi.fn(),
			save: vi.fn(),
			listKnownProjects,
			deleteOrphanedProjectMemory,
			reattachOrphanedProjectMemory,
		});
		const api = install(service);
		const entryId = "11111111-1111-4111-8111-111111111111";

		expect(await api.listKnownProjects()).toEqual([{ path: "/tmp/live", kind: "local" }]);
		expect(await api.deleteOrphanedProjectMemory({ path: "/tmp/gone" })).toEqual(projects);
		expect(deleteOrphanedProjectMemory).toHaveBeenCalledWith({ path: "/tmp/gone" });
		expect(await api.deleteOrphanedProjectMemory({ path: " /tmp/gone ", entryId })).toEqual(projects);
		expect(deleteOrphanedProjectMemory).toHaveBeenLastCalledWith({ path: "/tmp/gone", entryId });
		await expect(api.deleteOrphanedProjectMemory({ path: "  " })).rejects.toThrow("memory:store-rejected");
		await expect(api.deleteOrphanedProjectMemory({ path: "/tmp/gone", entryId: "nope" })).rejects.toThrow(
			"memory:store-rejected",
		);
		expect(deleteOrphanedProjectMemory).toHaveBeenCalledTimes(2);

		expect(await api.reattachOrphanedProjectMemory({ path: "/tmp/gone", targetPath: "/tmp/live", entryId })).toEqual(
			projects,
		);
		expect(reattachOrphanedProjectMemory).toHaveBeenCalledWith({
			path: "/tmp/gone",
			targetPath: "/tmp/live",
			entryId,
		});
		const reattachUnknown = api.reattachOrphanedProjectMemory as (value: unknown) => Promise<unknown>;
		await expect(reattachUnknown({ path: "/tmp/gone" })).rejects.toThrow("memory:store-rejected");
		expect(reattachOrphanedProjectMemory).toHaveBeenCalledTimes(1);
	});
});
