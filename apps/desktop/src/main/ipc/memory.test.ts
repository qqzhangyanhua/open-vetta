import type { IpcRenderer } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "../../preload/apis/memory.js";
import type { GenerateGlobalMemoryResult, GlobalMemoryEntry } from "../../shared/memory.js";
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
			candidates: [{ id: "22222222-2222-4222-8222-222222222222", text: "住在昆山", category: "location" }],
		};
		const service: MemoryIpcService = {
			listGlobal: vi.fn(async () => saved),
			generate: vi.fn(async () => generated),
			save: vi.fn(async () => saved),
		};
		const api = install(service);

		expect(await api.listGlobal()).toEqual(saved);
		expect(await api.generate("runtime-1")).toEqual(generated);
		expect(service.generate).toHaveBeenCalledWith("runtime-1");
		await expect(api.generate("   ")).rejects.toThrow();
		await expect(api.generate("x".repeat(257))).rejects.toThrow();
		expect(service.generate).toHaveBeenCalledTimes(1);

		expect(await api.save([{ text: "住在昆山", category: "location" }])).toEqual(saved);
		expect(service.save).toHaveBeenCalledWith([{ text: "住在昆山", category: "location" }]);
		await expect(api.save([{ text: "  ", category: "location" }])).rejects.toThrow("memory:invalid-candidates");
		const saveUnknown = api.save as (value: unknown) => Promise<GlobalMemoryEntry[]>;
		await expect(saveUnknown([{ text: "住在昆山", category: "project" }])).rejects.toThrow(
			"memory:invalid-candidates",
		);
		expect(service.save).toHaveBeenCalledTimes(1);

		teardown?.();
		expect(bridge.handlers.size).toBe(0);
	});
});
