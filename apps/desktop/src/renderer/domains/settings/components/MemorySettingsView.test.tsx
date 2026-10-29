// @vitest-environment jsdom

import type { DesktopMemoryApi, GlobalMemoryEntry, ProjectMemoryProject, SetMemoryPinnedInput } from "@/shared/memory";
import { i18n, initI18n } from "@shared/i18n";
import { confirmDialogAtom } from "@shared/store/atoms";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySettings } from "./MemorySettings";
import { useMemorySettingsModel } from "./useMemorySettingsModel";

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

afterEach(() => {
	cleanup();
	getDefaultStore().set(confirmDialogAtom, null);
});

function client(
	listGlobal: DesktopMemoryApi["listGlobal"],
	options: Partial<
		Pick<
			DesktopMemoryApi,
			| "listProjects"
			| "getReadEnabled"
			| "setReadEnabled"
			| "getProjectReadEnabled"
			| "setProjectReadEnabled"
			| "getModelOverride"
			| "setModelOverride"
			| "listModels"
			| "setPinned"
			| "updateEntry"
			| "deleteEntry"
			| "listKnownProjects"
			| "deleteOrphanedProjectMemory"
			| "reattachOrphanedProjectMemory"
		>
	> = {},
): DesktopMemoryApi {
	return {
		listGlobal,
		listProjects: options.listProjects ?? (async () => []),
		generate: vi.fn(),
		save: vi.fn(),
		updateEntry: options.updateEntry ?? vi.fn(async () => undefined),
		deleteEntry: options.deleteEntry ?? vi.fn(async () => undefined),
		getReadEnabled: options.getReadEnabled ?? (async () => true),
		setReadEnabled: options.setReadEnabled ?? (async (enabled) => enabled),
		getProjectReadEnabled: options.getProjectReadEnabled ?? (async () => true),
		setProjectReadEnabled: options.setProjectReadEnabled ?? (async (enabled) => enabled),
		getModelOverride: options.getModelOverride ?? vi.fn(async () => null),
		setModelOverride: options.setModelOverride ?? vi.fn(async () => undefined),
		listModels: options.listModels ?? vi.fn(async () => []),
		setPinned:
			options.setPinned ??
			(async (input: SetMemoryPinnedInput) => ({
				id: input.id,
				text: "unused",
				category: "other",
				recordedAt: "2026-10-28",
			})),
		listKnownProjects: options.listKnownProjects ?? (async () => []),
		deleteOrphanedProjectMemory: options.deleteOrphanedProjectMemory ?? vi.fn(async () => []),
		reattachOrphanedProjectMemory: options.reattachOrphanedProjectMemory ?? vi.fn(async () => []),
	};
}

function projectEntry(id: string, text: string, category: GlobalMemoryEntry["category"]): GlobalMemoryEntry {
	return { id, text, category, recordedAt: "2026-10-28" };
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
		expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.getByRole("button", { name: "编辑「我住在昆山」" }).className).toContain("opacity-0");
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
		expect(screen.queryByRole("switch", { name: "在对话里使用全局记忆" })).toBeNull();
		expect(screen.getByRole("switch", { name: "在对话里使用项目记忆" }).getAttribute("aria-checked")).toBe("true");
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
		expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();

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

	it("两个读取开关互相独立，关掉之后列表还在", async () => {
		const user = userEvent.setup();
		const setReadEnabled = vi.fn(async (enabled: boolean) => enabled);
		const setProjectReadEnabled = vi.fn(async (enabled: boolean) => enabled);
		render(
			<MemorySettings
				client={client(async () => [ENTRY], {
					setReadEnabled,
					setProjectReadEnabled,
				})}
			/>,
		);
		const globalToggle = await screen.findByRole("switch", { name: "在对话里使用全局记忆" });
		const projectToggle = screen.getByRole("switch", { name: "在对话里使用项目记忆" });
		expect(globalToggle.getAttribute("aria-checked")).toBe("true");
		expect(projectToggle.getAttribute("aria-checked")).toBe("true");
		expect(projectToggle.getAttribute("title")).toBe("从下一条消息起生效");

		await user.click(projectToggle);
		expect(setProjectReadEnabled).toHaveBeenCalledWith(false);
		expect(setReadEnabled).not.toHaveBeenCalled();
		expect(projectToggle.getAttribute("aria-checked")).toBe("false");
		expect(globalToggle.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("我住在昆山")).toBeTruthy();

		await user.click(globalToggle);
		expect(setReadEnabled).toHaveBeenCalledWith(false);
		expect(projectToggle.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByText(/还没有全局记忆/)).toBeNull();
	});

	it("项目页按项目筛选，对话项目显示为对话", async () => {
		const user = userEvent.setup();
		const projects: ProjectMemoryProject[] = [
			{
				path: "/tmp/alpha",
				kind: "local",
				orphaned: false,
				entries: [projectEntry("22222222-2222-4222-8222-222222222222", "这个仓库用 bun", "work")],
			},
			{
				path: "/tmp/conversation",
				kind: "conversation",
				orphaned: false,
				entries: [projectEntry("33333333-3333-4333-8333-333333333333", "对话里用中文", "preference")],
			},
		];
		render(<MemorySettings client={client(async () => [ENTRY], { listProjects: async () => projects })} />);
		expect(await screen.findByText("我住在昆山")).toBeTruthy();
		expect(screen.getByRole("tab", { name: "全局" }).getAttribute("aria-selected")).toBe("true");

		await user.click(screen.getByRole("tab", { name: "项目" }));
		expect(screen.getByText("这个仓库用 bun")).toBeTruthy();
		expect(screen.queryByText("我住在昆山")).toBeNull();
		expect(screen.queryByText("对话里用中文")).toBeNull();
		expect(screen.getByRole("button", { name: "筛选项目" }).textContent).toContain("/tmp/alpha");

		await user.click(screen.getByRole("button", { name: "筛选项目" }));
		await user.click(await screen.findByRole("button", { name: "对话" }));
		expect(screen.getByText("对话里用中文")).toBeTruthy();
		expect(screen.queryByText("这个仓库用 bun")).toBeNull();
		expect(screen.getByRole("button", { name: "筛选项目" }).textContent).toContain("对话");
		expect(screen.queryByRole("button", { name: "删除这条记忆：这个仓库用 bun" })).toBeNull();
	});

	it("没有项目记忆时说明要在该项目的会话里生成", async () => {
		const user = userEvent.setup();
		render(<MemorySettings client={client(async () => [])} />);
		expect(await screen.findByText(/还没有全局记忆/)).toBeTruthy();
		await user.click(screen.getByRole("tab", { name: "项目" }));
		expect(screen.getByText(/还没有这个项目的记忆/).textContent).toContain("这个项目");
	});

	it("项目记忆读失败时全局列表还在", async () => {
		const user = userEvent.setup();
		render(
			<MemorySettings
				client={client(async () => [ENTRY], {
					listProjects: async () => {
						throw new Error("memory:store-rejected");
					},
				})}
			/>,
		);
		expect(await screen.findByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByText(/项目记忆文件无法读取/)).toBeNull();
		expect(screen.getByRole("switch", { name: "在对话里使用项目记忆" })).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: "项目" }));
		expect((await screen.findByRole("alert")).textContent).toContain("项目记忆文件无法读取，已保持原样");
		expect(screen.queryByText("我住在昆山")).toBeNull();
		expect(screen.queryByText(/还没有这个项目的记忆/)).toBeNull();
		expect(screen.getByRole("switch", { name: "在对话里使用全局记忆" })).toBeTruthy();
	});

	it("可以改文字、改分类、改范围，按分类筛选，并在确认后删除", async () => {
		const user = userEvent.setup();
		const updateEntry = vi.fn(async () => undefined);
		const deleteEntry = vi.fn(async () => undefined);
		const tea: GlobalMemoryEntry = {
			id: "44444444-4444-4444-8444-444444444444",
			text: "喜欢喝茶",
			category: "preference",
			recordedAt: "2026-10-28",
		};
		const projects: ProjectMemoryProject[] = [
			{
				path: "/tmp/alpha",
				kind: "local",
				orphaned: false,
				entries: [projectEntry("22222222-2222-4222-8222-222222222222", "这个仓库用 bun", "work")],
			},
		];
		render(
			<MemorySettings
				client={client(async () => [ENTRY, tea], {
					listProjects: async () => projects,
					updateEntry,
					deleteEntry,
				})}
			/>,
		);

		expect(await screen.findByText("我住在昆山")).toBeTruthy();
		expect(screen.getByText("喜欢喝茶")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();

		await user.click(screen.getByRole("button", { name: "筛选分类" }));
		await user.click(await screen.findByRole("button", { name: "位置" }));
		expect(screen.getByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByText("喜欢喝茶")).toBeNull();

		await user.click(screen.getByRole("button", { name: "筛选分类" }));
		await user.click(await screen.findByRole("button", { name: "全部分类" }));
		expect(screen.getByText("喜欢喝茶")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "编辑「我住在昆山」" }));
		const textbox = screen.getByRole("textbox", { name: "记忆正文" });
		await user.clear(textbox);
		await user.type(textbox, "我住在苏州");
		await user.click(screen.getByRole("button", { name: "分类" }));
		await user.click(await screen.findByRole("button", { name: "家庭" }));
		await user.click(screen.getByRole("button", { name: "范围" }));
		await user.click(await screen.findByRole("button", { name: "放到项目" }));
		expect(screen.getByRole("button", { name: "目标项目" }).textContent).toContain("/tmp/alpha");
		expect(screen.getByRole("button", { name: "保存这条记忆" }).getAttribute("title")).toBe("从下一条消息起生效");

		await user.click(screen.getByRole("button", { name: "保存这条记忆" }));
		await waitFor(() =>
			expect(updateEntry).toHaveBeenCalledWith({
				id: ENTRY.id,
				text: "我住在苏州",
				category: "family",
				scope: "project",
				projectPath: "/tmp/alpha",
			}),
		);
		expect(screen.queryByText("我住在昆山")).toBeNull();
		expect(screen.queryByText("我住在苏州")).toBeNull();
		expect(screen.getByText("喜欢喝茶")).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: "项目" }));
		expect(screen.getByText("我住在苏州")).toBeTruthy();
		expect(screen.getByText("家庭")).toBeTruthy();
		expect(screen.getByText("这个仓库用 bun")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "筛选分类" }));
		await user.click(await screen.findByRole("button", { name: "家庭" }));
		expect(screen.getByText("我住在苏州")).toBeTruthy();
		expect(screen.queryByText("这个仓库用 bun")).toBeNull();

		await user.click(screen.getByRole("button", { name: "删除「我住在苏州」" }));
		expect(screen.getByText("我住在苏州")).toBeTruthy();
		expect(deleteEntry).not.toHaveBeenCalled();
		expect(screen.getByRole("group", { name: "删除这条记忆？" }).textContent).toContain("从下一条消息起");
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.queryByRole("group", { name: "删除这条记忆？" })).toBeNull();
		expect(screen.getByText("我住在苏州")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "删除「我住在苏州」" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));
		await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith(ENTRY.id));
		expect(screen.queryByText("我住在苏州")).toBeNull();
		expect(screen.getByText("这个分类下没有记忆。")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "筛选分类" }));
		await user.click(await screen.findByRole("button", { name: "全部分类" }));
		expect(screen.getByText("这个仓库用 bun")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
	});

	it("保存还没返回时再点一次不会再发请求，编辑控件也不能改", async () => {
		const user = userEvent.setup();
		let releaseHook: (() => void) | undefined;
		const updateEntry = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseHook = resolve;
				}),
		);
		const memoryClient = client(async () => [ENTRY], { updateEntry });
		const { result } = renderHook(() => useMemorySettingsModel(memoryClient));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		act(() => result.current.actions.startEdit(ENTRY));
		act(() => {
			result.current.actions.saveEdit();
			result.current.actions.saveEdit();
		});
		expect(updateEntry).toHaveBeenCalledTimes(1);

		let releaseView: (() => void) | undefined;
		const updateEntryView = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseView = resolve;
				}),
		);
		render(<MemorySettings client={client(async () => [ENTRY], { updateEntry: updateEntryView })} />);
		await user.click(await screen.findByRole("button", { name: "编辑「我住在昆山」" }));
		await user.click(screen.getByRole("button", { name: "保存这条记忆" }));
		expect(screen.getByRole("textbox", { name: "记忆正文" })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "分类", exact: true })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "范围", exact: true })).toHaveProperty("disabled", true);
		expect(updateEntryView).toHaveBeenCalledTimes(1);
		releaseView?.();
		await waitFor(() => expect(screen.queryByRole("textbox", { name: "记忆正文" })).toBeNull());
		await act(async () => {
			releaseHook?.();
		});
	});

	it("保存失败时条目保持原样", async () => {
		const user = userEvent.setup();
		render(
			<MemorySettings
				client={client(async () => [ENTRY], {
					updateEntry: async () => {
						throw new Error("memory:store-rejected");
					},
				})}
			/>,
		);
		await user.click(await screen.findByRole("button", { name: "编辑「我住在昆山」" }));
		const textbox = screen.getByRole("textbox", { name: "记忆正文" });
		await user.clear(textbox);
		await user.type(textbox, "我住在苏州");
		await user.click(screen.getByRole("button", { name: "保存这条记忆" }));
		expect((await screen.findByRole("alert")).textContent).toContain("没有改成这条记忆，已保持原样");
		expect(screen.getByRole("textbox", { name: "记忆正文" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.getByText("我住在昆山")).toBeTruthy();
		expect(screen.queryByText("我住在苏州")).toBeNull();
	});

	it("英文界面使用记忆范围文案", async () => {
		const user = userEvent.setup();
		await i18n.changeLanguage("en");
		const projects: ProjectMemoryProject[] = [
			{
				path: "/tmp/conversation",
				kind: "conversation",
				orphaned: false,
				entries: [projectEntry("33333333-3333-4333-8333-333333333333", "Use Chinese in conversation", "preference")],
			},
			{
				path: "/tmp/gone",
				kind: "local",
				orphaned: true,
				entries: [projectEntry("44444444-4444-4444-8444-444444444444", "Old project fact", "work")],
			},
		];
		render(<MemorySettings client={client(async () => [ENTRY], { listProjects: async () => projects })} />);
		expect(await screen.findByRole("switch", { name: "Use global memory in chat" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Use project memory in chat" })).toBeTruthy();
		expect(screen.getByRole("button", { name: 'Edit "我住在昆山"' })).toBeTruthy();
		expect(screen.getByRole("button", { name: 'Delete "我住在昆山"' })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Filter by category" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "New memory" })).toBeNull();
		expect(screen.getByRole("tab", { name: "Global" }).getAttribute("aria-selected")).toBe("true");
		await user.click(screen.getByRole("tab", { name: "Project" }));
		expect(screen.getByRole("button", { name: "Filter by project" }).textContent).toContain("Conversation");
		expect(screen.getByText("Use Chinese in conversation")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Pin: 我住在昆山" })).toBeNull();
		expect(screen.getByRole("button", { name: "Pin: Use Chinese in conversation" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
		expect(screen.getByText("This project no longer exists")).toBeTruthy();
		expect(screen.getByText("/tmp/gone")).toBeTruthy();
		expect(screen.getByText("Old project fact")).toBeTruthy();
	});

	it("可以把一条标成常驻，写失败时回到原来的状态", async () => {
		const user = userEvent.setup();
		const setPinned = vi.fn(async (input: SetMemoryPinnedInput) => {
			if (!input.pinned) throw new Error("memory:not-found");
			return { ...ENTRY, pinned: true };
		});
		render(<MemorySettings client={client(async () => [ENTRY], { setPinned })} />);
		const pin = await screen.findByRole("button", { name: "设为常驻：我住在昆山" });
		expect(pin.getAttribute("aria-pressed")).toBe("false");

		await user.click(pin);
		expect(setPinned).toHaveBeenCalledWith({ id: ENTRY.id, scope: "global", pinned: true });
		const unpin = screen.getByRole("button", { name: "取消常驻：我住在昆山" });
		expect(unpin.getAttribute("aria-pressed")).toBe("true");

		await user.click(unpin);
		expect(setPinned).toHaveBeenLastCalledWith({ id: ENTRY.id, scope: "global", pinned: false });
		expect((await screen.findByRole("button", { name: "取消常驻：我住在昆山" })).getAttribute("aria-pressed")).toBe(
			"true",
		);
	});

	it("项目记忆的常驻只提交当前项目", async () => {
		const user = userEvent.setup();
		const projectId = "22222222-2222-4222-8222-222222222222";
		const setPinned = vi.fn(async (input: SetMemoryPinnedInput) => ({
			...projectEntry(projectId, "这个仓库用 bun", "work"),
			...(input.pinned ? { pinned: true as const } : {}),
		}));
		const projects: ProjectMemoryProject[] = [
			{
				path: "/tmp/alpha",
				kind: "local",
				orphaned: false,
				entries: [projectEntry(projectId, "这个仓库用 bun", "work")],
			},
		];
		render(<MemorySettings client={client(async () => [ENTRY], { listProjects: async () => projects, setPinned })} />);
		expect(await screen.findByRole("button", { name: "设为常驻：我住在昆山" })).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: "项目" }));
		await user.click(screen.getByRole("button", { name: "设为常驻：这个仓库用 bun" }));
		expect(setPinned).toHaveBeenCalledWith({
			id: projectId,
			scope: "project",
			projectPath: "/tmp/alpha",
			pinned: true,
		});
		expect(setPinned).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "取消常驻：这个仓库用 bun" }).getAttribute("aria-pressed")).toBe("true");
	});

	it("把失联记忆单独成组，确认后才能删除一条或整组", async () => {
		const user = userEvent.setup();
		const orphan = {
			path: "/tmp/gone",
			kind: "local" as const,
			orphaned: true,
			entries: [
				projectEntry("44444444-4444-4444-8444-444444444444", "旧事实", "work"),
				projectEntry("55555555-5555-4555-8555-555555555555", "还留着", "preference"),
			],
		};
		const live = {
			path: "/tmp/alpha",
			kind: "local" as const,
			orphaned: false,
			entries: [projectEntry("22222222-2222-4222-8222-222222222222", "这个仓库用 bun", "work")],
		};
		const deleteOrphanedProjectMemory = vi.fn(async (input: { path: string; entryId?: string }) =>
			input.entryId ? [{ ...orphan, entries: orphan.entries.filter((entry) => entry.id !== input.entryId) }] : [live],
		);
		render(
			<MemorySettings
				client={client(async () => [], {
					listProjects: async () => [live, orphan],
					deleteOrphanedProjectMemory,
				})}
			/>,
		);
		await user.click(await screen.findByRole("tab", { name: "项目" }));
		expect(screen.getByText("项目已不存在")).toBeTruthy();
		expect(screen.getByText("/tmp/gone")).toBeTruthy();
		expect(screen.getByText("旧事实")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "筛选项目" }));
		expect(screen.queryByRole("button", { name: "/tmp/gone" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "/tmp/alpha" }));

		await user.click(screen.getByRole("button", { name: "删除这条记忆：旧事实" }));
		const confirmation = getDefaultStore().get(confirmDialogAtom);
		expect(deleteOrphanedProjectMemory).not.toHaveBeenCalled();
		expect(confirmation).toMatchObject({ variant: "danger", confirmLabel: "删除" });
		confirmation?.onConfirm(false);
		await waitFor(() => expect(deleteOrphanedProjectMemory).toHaveBeenCalledWith({
			path: "/tmp/gone",
			entryId: "44444444-4444-4444-8444-444444444444",
		}));
		await waitFor(() => expect(screen.queryByText("旧事实")).toBeNull());
		expect(screen.getByText("还留着")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "删除这组记忆：/tmp/gone" }));
		expect(deleteOrphanedProjectMemory).toHaveBeenCalledTimes(1);
		getDefaultStore().get(confirmDialogAtom)?.onConfirm(false);
		await waitFor(() => expect(deleteOrphanedProjectMemory).toHaveBeenCalledWith({ path: "/tmp/gone" }));
		await waitFor(() => expect(screen.queryByText("项目已不存在")).toBeNull());
		expect(screen.queryByText("还留着")).toBeNull();
	});

	it("把失联记忆重新挂到一个还没有记忆的项目", async () => {
		const user = userEvent.setup();
		const orphan = {
			path: "/tmp/gone",
			kind: "local" as const,
			orphaned: true,
			entries: [projectEntry("44444444-4444-4444-8444-444444444444", "旧事实", "work")],
		};
		const live = {
			path: "/tmp/alpha",
			kind: "local" as const,
			orphaned: false,
			entries: [projectEntry("22222222-2222-4222-8222-222222222222", "这个仓库用 bun", "work")],
		};
		const reattachOrphanedProjectMemory = vi.fn(async () => [
			live,
			{
				path: "/tmp/fresh",
				kind: "local" as const,
				orphaned: false,
				entries: orphan.entries,
			},
		]);
		render(
			<MemorySettings
				client={client(async () => [], {
					listProjects: async () => [live, orphan],
					listKnownProjects: async () => [
						{ path: "/tmp/alpha", kind: "local" },
						{ path: "/tmp/fresh", kind: "local" },
					],
					reattachOrphanedProjectMemory,
				})}
			/>,
		);
		await user.click(await screen.findByRole("tab", { name: "项目" }));
		expect(await screen.findByText("项目已不存在")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "把这组记忆挂到的项目：/tmp/gone" }));
		await user.click(await screen.findByRole("button", { name: "/tmp/fresh" }));
		await user.click(screen.getByRole("button", { name: "重新挂靠这组记忆：/tmp/gone" }));
		await waitFor(() =>
			expect(reattachOrphanedProjectMemory).toHaveBeenCalledWith({ path: "/tmp/gone", targetPath: "/tmp/fresh" }),
		);
		await waitFor(() => expect(screen.queryByText("项目已不存在")).toBeNull());
		await user.click(screen.getByRole("button", { name: "筛选项目" }));
		await user.click(await screen.findByRole("button", { name: "/tmp/fresh" }));
		expect(screen.getByText("旧事实")).toBeTruthy();
	});

	it("从项目详情打开时直接停在该项目，对不上就不退回第一个", async () => {
		const projects: ProjectMemoryProject[] = [
			{
				path: "/tmp/alpha",
				kind: "local",
				orphaned: false,
				entries: [projectEntry("22222222-2222-4222-8222-222222222222", "这个仓库用 bun", "work")],
			},
			{
				path: "/tmp/beta",
				kind: "local",
				orphaned: false,
				entries: [projectEntry("33333333-3333-4333-8333-333333333333", "beta 的事实", "work")],
			},
		];
		const { unmount } = render(
			<MemorySettings projectPath="/tmp/beta/" client={client(async () => [], { listProjects: async () => projects })} />,
		);
		expect((await screen.findByRole("tab", { name: "项目" })).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("beta 的事实")).toBeTruthy();
		expect(screen.queryByText("这个仓库用 bun")).toBeNull();
		expect(screen.getByRole("button", { name: "筛选项目" }).textContent).toContain("/tmp/beta");

		unmount();
		render(
			<MemorySettings
				projectPath="/tmp/missing"
				client={client(async () => [], { listProjects: async () => projects })}
			/>,
		);
		expect((await screen.findByRole("tab", { name: "项目" })).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText(/还没有这个项目的记忆/)).toBeTruthy();
		expect(screen.queryByText("这个仓库用 bun")).toBeNull();
		expect(screen.queryByText("beta 的事实")).toBeNull();
	});
});
