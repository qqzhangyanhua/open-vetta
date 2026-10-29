// @vitest-environment jsdom

import type { DesktopMemoryApi, GenerateGlobalMemoryResult, SaveMemoryCandidate } from "@/shared/memory";
import { i18n, initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMemoryElements } from "./sessionMemoryElements";
import { useMemoryReviewModel } from "./useMemoryReviewModel";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(async () => {
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(() => true),
	}));
	HTMLElement.prototype.scrollIntoView = vi.fn();
	HTMLElement.prototype.hasPointerCapture = () => false;
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = () => undefined;
	initI18n();
	await i18n.changeLanguage("zh");
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function Harness({
	client,
	runtimeId,
}: {
	readonly client: DesktopMemoryApi | null;
	readonly runtimeId: string | null;
}): JSX.Element {
	const model = useMemoryReviewModel(runtimeId, client);
	const { menu, panel } = sessionMemoryElements(model);
	return (
		<div>
			{menu}
			{panel}
			<button type="button">发送</button>
		</div>
	);
}

const CANDIDATE = {
	id: "11111111-1111-4111-8111-111111111111",
	text: "我住在昆山",
	category: "location" as const,
};

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
	await user.click(screen.getByRole("button", { name: "更多" }));
	await user.click(await screen.findByRole("menuitem", { name: "生成记忆" }));
}

describe("会话记忆审阅", () => {
	it("打开后先显示正在读取，改完候选再保存，会话仍可使用", async () => {
		const user = userEvent.setup();
		let release: (result: GenerateGlobalMemoryResult) => void = () => undefined;
		const generate = vi.fn(
			() =>
				new Promise<GenerateGlobalMemoryResult>((resolve) => {
					expect(screen.getByText("正在通读这个会话…")).toBeTruthy();
					release = resolve;
				}),
		);
		const save = vi.fn(async (_candidates: readonly SaveMemoryCandidate[]) => []);
		render(
			<Harness
				runtimeId="runtime-1"
				client={{ listGlobal: vi.fn(async () => []), generate, save }}
			/>,
		);

		await openMenu(user);
		await waitFor(() => expect(generate).toHaveBeenCalledWith("runtime-1"));
		expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByText("正在通读这个会话…")).toBeTruthy();
		await waitFor(() => {
			expect(document.body.style.pointerEvents).not.toBe("none");
		});

		release({
			status: "candidates",
			candidates: [
				CANDIDATE,
				{ ...CANDIDATE, id: "22222222-2222-4222-8222-222222222222", text: "孩子要上小学", category: "family" },
			],
		});
		expect(((await screen.findByRole("checkbox", { name: "我住在昆山" })) as HTMLInputElement).checked).toBe(true);
		const candidateList = screen.getByRole("list");
		expect(candidateList.className).toContain("overflow-y-auto");
		expect(candidateList.className).toContain("max-h-");
		const review = screen.getByRole("region", { name: "审阅记忆" });
		const saveButton = screen.getByRole("button", { name: "保存" });
		const closeButton = screen.getByRole("button", { name: "关闭" });
		expect(review.contains(saveButton)).toBe(true);
		expect(review.contains(closeButton)).toBe(true);
		expect(candidateList.contains(saveButton)).toBe(false);
		expect(candidateList.contains(closeButton)).toBe(false);

		await user.click(screen.getByRole("checkbox", { name: "孩子要上小学" }));
		const boxes = screen.getAllByRole("textbox");
		await user.clear(boxes[0]!);
		await user.type(boxes[0]!, "住在昆山");
		await user.selectOptions(screen.getAllByRole("combobox")[0]!, "work");
		await user.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(save).toHaveBeenCalledWith([{ text: "住在昆山", category: "work" }]);
		});
		await waitFor(() => {
			expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		});
		expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
	});

	it("生成失败可以重试，关闭会丢掉还没保存的候选", async () => {
		const user = userEvent.setup();
		const generate = vi
			.fn<DesktopMemoryApi["generate"]>()
			.mockRejectedValueOnce(new Error("memory:generation-failed"))
			.mockResolvedValueOnce({ status: "empty" });
		const save = vi.fn(async () => []);
		render(<Harness runtimeId="runtime-1" client={{ listGlobal: vi.fn(async () => []), generate, save }} />);

		await openMenu(user);
		expect((await screen.findByRole("alert")).textContent).toContain("生成失败，没有写入任何内容");
		expect(save).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByText("没有可保存的新记忆")).toBeTruthy();
		expect(generate).toHaveBeenCalledTimes(2);

		await user.click(screen.getByRole("button", { name: "关闭" }));
		expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		expect(save).not.toHaveBeenCalled();
	});

	it("关闭后迟到的候选不会再打开面板", async () => {
		const user = userEvent.setup();
		let release: (result: GenerateGlobalMemoryResult) => void = () => undefined;
		const generate = vi.fn(
			() =>
				new Promise<GenerateGlobalMemoryResult>((resolve) => {
					release = resolve;
				}),
		);
		render(<Harness runtimeId="runtime-1" client={{ listGlobal: vi.fn(async () => []), generate, save: vi.fn() }} />);
		await openMenu(user);
		await waitFor(() => expect(generate).toHaveBeenCalled());
		expect(screen.getByText("正在通读这个会话…")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "关闭" }));
		await act(async () => {
			release({ status: "candidates", candidates: [CANDIDATE] });
			await generate.mock.results[0]?.value;
		});
		expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		expect(screen.queryByText("我住在昆山")).toBeNull();
	});

	it("保存失败时留下草稿", async () => {
		const user = userEvent.setup();
		const save = vi.fn(async () => {
			throw new Error("memory:store-rejected");
		});
		render(
			<Harness
				runtimeId="runtime-1"
				client={{
					listGlobal: vi.fn(async () => []),
					generate: vi.fn(async (): Promise<GenerateGlobalMemoryResult> => ({
						status: "candidates",
						candidates: [CANDIDATE],
					})),
					save,
				}}
			/>,
		);
		await openMenu(user);
		expect(((await screen.findByRole("checkbox", { name: "我住在昆山" })) as HTMLInputElement).checked).toBe(true);
		await user.click(screen.getByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("记忆文件无法读取，已保持原样");
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("我住在昆山");
	});

	it("识别 Electron 包过的保存错误码", async () => {
		const user = userEvent.setup();
		const save = vi.fn(async () => {
			throw new Error("Error invoking remote method 'memory:save': Error: memory:store-rejected");
		});
		render(
			<Harness
				runtimeId="runtime-1"
				client={{
					listGlobal: vi.fn(async () => []),
					generate: vi.fn(async (): Promise<GenerateGlobalMemoryResult> => ({
						status: "candidates",
						candidates: [CANDIDATE],
					})),
					save,
				}}
			/>,
		);
		await openMenu(user);
		await user.click(await screen.findByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("记忆文件无法读取，已保持原样");
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("我住在昆山");
	});

	it("换会话后丢掉上一份候选", async () => {
		const user = userEvent.setup();
		const client: DesktopMemoryApi = {
			listGlobal: vi.fn(async () => []),
			generate: vi.fn(async (): Promise<GenerateGlobalMemoryResult> => ({
				status: "candidates",
				candidates: [CANDIDATE],
			})),
			save: vi.fn(async () => []),
		};
		function Switchable(): JSX.Element {
			const [runtimeId, setRuntimeId] = useState("runtime-1");
			return (
				<div>
					<button type="button" onClick={() => setRuntimeId("runtime-2")}>
						切换
					</button>
					<Harness runtimeId={runtimeId} client={client} />
				</div>
			);
		}
		render(<Switchable />);
		await openMenu(user);
		expect(await screen.findByText("我住在昆山")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "切换" }));
		await waitFor(() => {
			expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		});
	});
});
