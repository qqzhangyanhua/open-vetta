// @vitest-environment jsdom

import type { DesktopMemoryApi, GlobalMemoryEntry } from "@/shared/memory";
import { i18n, initI18n } from "@shared/i18n";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function client(listGlobal: DesktopMemoryApi["listGlobal"]): DesktopMemoryApi {
	return { listGlobal, generate: vi.fn(), save: vi.fn() };
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
		await waitFor(() => {
			expect(screen.queryByText(/还没有全局记忆/)).toBeNull();
		});
	});
});
