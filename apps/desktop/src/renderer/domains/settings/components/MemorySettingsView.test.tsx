// @vitest-environment jsdom

import type { DesktopMemoryApi, GlobalMemoryEntry, ProjectMemoryProject } from "@/shared/memory";
import { i18n, initI18n } from "@shared/i18n";
import { confirmDialogAtom } from "@shared/store/atoms";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
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
		getReadEnabled: options.getReadEnabled ?? (async () => true),
		setReadEnabled: options.setReadEnabled ?? (async (enabled) => enabled),
		getProjectReadEnabled: options.getProjectReadEnabled ?? (async () => true),
		setProjectReadEnabled: options.setProjectReadEnabled ?? (async (enabled) => enabled),
		getModelOverride: options.getModelOverride ?? vi.fn(async () => null),
		setModelOverride: options.setModelOverride ?? vi.fn(async () => undefined),
		listModels: options.listModels ?? vi.fn(async () => []),
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
		expect(screen.getByRole("tab", { name: "Global" }).getAttribute("aria-selected")).toBe("true");
		await user.click(screen.getByRole("tab", { name: "Project" }));
		expect(screen.getByRole("button", { name: "Filter by project" }).textContent).toContain("Conversation");
		expect(screen.getByText("Use Chinese in conversation")).toBeTruthy();
		expect(screen.getByText("This project no longer exists")).toBeTruthy();
		expect(screen.getByText("/tmp/gone")).toBeTruthy();
		expect(screen.getByText("Old project fact")).toBeTruthy();
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
