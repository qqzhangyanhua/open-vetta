// @vitest-environment jsdom

import type { DesktopMemoryApi, GlobalMemoryEntry } from "@/shared/memory";
import { i18n, initI18n } from "@shared/i18n";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySettings } from "./MemorySettings";

const ENTRY: GlobalMemoryEntry = {
	id: "11111111-1111-4111-8111-111111111111",
	text: "我住在昆山",
	category: "location",
	recordedAt: "2026-10-28",
};

beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});

afterEach(() => cleanup());

function client(
	listGlobal: DesktopMemoryApi["listGlobal"],
	options: Partial<
		Pick<DesktopMemoryApi, "getReadEnabled" | "setReadEnabled" | "getModelOverride" | "setModelOverride" | "listModels">
	> = {},
): DesktopMemoryApi {
	return {
		listGlobal,
		generate: vi.fn(),
		save: vi.fn(),
		getReadEnabled: options.getReadEnabled ?? (async () => true),
		setReadEnabled: options.setReadEnabled ?? (async (enabled) => enabled),
		getModelOverride: options.getModelOverride ?? vi.fn(async () => null),
		setModelOverride: options.setModelOverride ?? vi.fn(async () => undefined),
		listModels: options.listModels ?? vi.fn(async () => []),
	};
}

describe("设置页记忆列表", () => {
	it("先显示正在读取，再列出日期、分类和正文", async () => {
		let resolveList: (entries: GlobalMemoryEntry[]) => void = () => undefined;
		render(
			<MemorySettings
				client={client(
					() =>
						new Promise((resolve) => {
							resolveList = resolve;
						}),
				)}
			/>,
		);
		expect(screen.getByText("正在读取记忆")).toBeTruthy();
		expect(screen.queryByText("我住在昆山")).toBeNull();

		resolveList([ENTRY]);
		expect(await screen.findByText("我住在昆山")).toBeTruthy();
		expect(screen.getByText("位置")).toBeTruthy();
		expect(screen.getByText("2026-10-28").tagName).toBe("TIME");
		expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("没有记忆时说明从标题栏生成", async () => {
		render(<MemorySettings client={client(async () => [])} />);
		expect((await screen.findByText(/还没有全局记忆/)).textContent).toContain("生成记忆");
	});

	it("读失败时说明文件保持原样，而不是空列表", async () => {
		render(
			<MemorySettings
				client={client(async () => {
					throw new Error("memory:store-rejected");
				})}
			/>,
		);
		expect((await screen.findByRole("alert")).textContent).toContain("记忆文件无法读取，已保持原样");
		expect(screen.queryByRole("switch")).toBeNull();
		await waitFor(() => {
			expect(screen.queryByText(/还没有全局记忆/)).toBeNull();
		});
	});

	it("默认打开读取开关，关掉后列表还在", async () => {
		const user = userEvent.setup();
		const setReadEnabled = vi.fn(async (enabled: boolean) => enabled);
		render(
			<MemorySettings
				client={client(async () => [ENTRY], {
					setReadEnabled,
				})}
			/>,
		);
		const toggle = await screen.findByRole("switch", { name: "在对话里使用全局记忆" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(toggle.getAttribute("title")).toBe("从下一条消息起生效");
		expect(screen.getByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "删除" })).toBeNull();

		await user.click(toggle);
		expect(setReadEnabled).toHaveBeenCalledWith(false);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByText(/还没有全局记忆/)).toBeNull();
	});

	it("开关关闭时仍显示已保存的记忆", async () => {
		render(<MemorySettings client={client(async () => [ENTRY], { getReadEnabled: async () => false })} />);
		const toggle = await screen.findByRole("switch", { name: "在对话里使用全局记忆" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByText("我住在昆山")).toBeTruthy();
	});

	it("可以选择记忆模型，也可以改回使用会话当前模型", async () => {
		const user = userEvent.setup();
		const setModelOverride = vi.fn(async () => undefined);
		render(
			<MemorySettings
				client={client(async () => [], {
					setModelOverride,
					listModels: async () => [{ modelKey: "openai/memory-model", label: "Memory Model" }],
				})}
			/>,
		);

		expect(await screen.findByText("记忆模型")).toBeTruthy();
		expect(screen.getByText("不指定时，用这条会话当前的模型。")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "记忆模型" }));
		await user.click(await screen.findByRole("button", { name: "Memory Model" }));
		await waitFor(() => expect(setModelOverride).toHaveBeenCalledWith("openai/memory-model"));
		expect(screen.getByRole("button", { name: "记忆模型" }).textContent).toContain("Memory Model");

		await user.click(screen.getByRole("button", { name: "记忆模型" }));
		await user.click(await screen.findByRole("button", { name: "使用会话当前模型" }));
		await waitFor(() => expect(setModelOverride).toHaveBeenLastCalledWith(null));
		expect(screen.getByRole("button", { name: "记忆模型" }).textContent).toContain("使用会话当前模型");
	});

	it("记忆模型读失败时仍可以改选或清空", async () => {
		const user = userEvent.setup();
		const setModelOverride = vi.fn(async () => undefined);
		render(
			<MemorySettings
				client={client(async () => [], {
					getModelOverride: async () => {
						throw new Error("memory:invalid-model");
					},
					setModelOverride,
					listModels: async () => [{ modelKey: "openai/memory-model", label: "Memory Model" }],
				})}
			/>,
		);

		expect((await screen.findByRole("alert")).textContent).toContain("记忆模型设置无法读取");
		await user.click(screen.getByRole("button", { name: "记忆模型" }));
		await user.click(await screen.findByRole("button", { name: "Memory Model" }));
		await waitFor(() => expect(setModelOverride).toHaveBeenCalledWith("openai/memory-model"));

		await user.click(screen.getByRole("button", { name: "记忆模型" }));
		await user.click(await screen.findByRole("button", { name: "使用会话当前模型" }));
		await waitFor(() => expect(setModelOverride).toHaveBeenLastCalledWith(null));
	});
});
