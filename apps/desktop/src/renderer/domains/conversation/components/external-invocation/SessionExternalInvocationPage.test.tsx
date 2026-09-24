// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalInvocationTerminalSession } from "./ExternalInvocationTerminalSession";
import { clearExternalRecipients } from "@shared/store/external-recipient";
import { SessionExternalInvocationPage, type ExternalInvocationClient, type ExternalInvocationClientEvent } from "./SessionExternalInvocationPage";

beforeEach(async () => {
	clearExternalRecipients();
	initI18n();
	await i18n.changeLanguage("zh");
});

afterEach(() => cleanup());

function Harness({ client }: { client: ExternalInvocationClient }): JSX.Element {
	const [prompt, setPrompt] = useState("");
	return (
		<SessionExternalInvocationPage
			session={{ sessionId: "session-1", cwd: "/work/app" }}
			client={client}
			prompt={prompt}
			onPromptChange={setPrompt}
			showPrompt
			penguinTools={
				<>
					<span>模型</span>
					<span>完全访问</span>
				</>
			}
		/>
	);
}

describe("session page external invocation", () => {
	it("shows Grok copy, hides model and access, then updates the card from fake events", async () => {
		const user = userEvent.setup();
		const start = vi.fn(async () => ({ invocationId: "inv-1" }));
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start,
			subscribe: (_sessionId, next) => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
		};
		render(<Harness client={client} />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect(screen.getByText("这条消息会交给 Grok 在终端里执行，输出保留在本会话")).toBeTruthy();
		expect(screen.getByText("由 Grok 自己的权限设置决定，需要确认时会在终端里询问")).toBeTruthy();
		expect(screen.getByRole("button", { name: "发给 Grok" })).toBeTruthy();
		expect(screen.queryByText("模型")).toBeNull();
		expect(screen.queryByText("完全访问")).toBeNull();
		await user.type(screen.getByLabelText("消息"), "fix the test");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenCalledWith({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "fix the test",
			agentId: "grok",
			referencedPaths: [],
		});
		await act(async () => {
			listener?.({ type: "running", invocationId: "inv-1", prompt: "fix the test", agentId: "grok" });
		});
		expect(screen.getByText("运行中")).toBeTruthy();
		await act(async () => {
			listener?.({ type: "completed", invocationId: "inv-1", exitCode: 0 });
		});
		await waitFor(() => expect(screen.getByText("已完成")).toBeTruthy());
		expect(screen.getByText("退出码 0")).toBeTruthy();
	});

	it("keeps Grok for the same session and starts a new session on penguin", async () => {
		const user = userEvent.setup();
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		function Switcher(): JSX.Element {
			const [draftKey, setDraftKey] = useState("session-a");
			return (
				<>
					<button type="button" onClick={() => setDraftKey("session-b")}>
						打开另一个会话
					</button>
					<button type="button" onClick={() => setDraftKey("session-a")}>
						回到这个会话
					</button>
					<button type="button" onClick={() => setDraftKey("new:/work/fresh")}>
						新会话
					</button>
					<SessionExternalInvocationPage
						session={{ sessionId: draftKey, cwd: "/work/app" }}
						client={client}
						draftKey={draftKey}
						prompt=""
						onPromptChange={() => undefined}
						showPrompt={false}
						penguinTools={null}
					/>
				</>
			);
		}
		render(<Switcher />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("grok");
		await user.click(screen.getByRole("button", { name: "打开另一个会话" }));
		expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("penguin");
		await user.click(screen.getByRole("button", { name: "回到这个会话" }));
		expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("grok");
		await user.click(screen.getByRole("button", { name: "新会话" }));
		expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("penguin");
	});

	it("refuses to send while an image is attached, then sends after it is removed, and hides skills", async () => {
		const user = userEvent.setup();
		const start = vi.fn(async () => ({ invocationId: "inv-1" }));
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start,
			subscribe: () => () => undefined,
		};
		function Images(): JSX.Element {
			const [images, setImages] = useState([{ path: "/tmp/shot.png", name: "shot.png" }]);
			const [prompt, setPrompt] = useState("look");
			return (
				<SessionExternalInvocationPage
					session={{ sessionId: "session-1", cwd: "/work/app" }}
					client={client}
					prompt={prompt}
					onPromptChange={setPrompt}
					showPrompt
					penguinTools={null}
					images={images}
					onRemoveImage={(path) => setImages((current) => current.filter((image) => image.path !== path))}
					skills={<button type="button">技能/场景</button>}
				/>
			);
		}
		render(<Images />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		expect(screen.getByRole("button", { name: "技能/场景" })).toBeTruthy();
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect(screen.queryByRole("button", { name: "技能/场景" })).toBeNull();
		expect(screen.getByText("Grok 不接收图片")).toBeTruthy();
		expect((screen.getByRole("button", { name: "发给 Grok" }) as HTMLButtonElement).disabled).toBe(true);
		await user.click(screen.getByRole("button", { name: "移除图片" }));
		expect(screen.queryByText("Grok 不接收图片")).toBeNull();
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentId: "grok", prompt: "look" }));
	});

	it("disables external agents in a remote project and explains why", async () => {
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		render(
			<SessionExternalInvocationPage
				session={{ sessionId: "session-1", cwd: "ssh://host-1/srv/app" }}
				client={client}
				prompt="fix"
				onPromptChange={() => undefined}
				showPrompt
				penguinTools={null}
				remote
			/>,
		);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		expect((screen.getByRole("option", { name: "Grok" }) as HTMLOptionElement).disabled).toBe(true);
		expect(screen.getByText("远程项目暂不支持")).toBeTruthy();
	});

	it("offers only penguin when no external agent is available", async () => {
		const client: ExternalInvocationClient = {
			listAgents: async () => [],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		render(<Harness client={client} />);
		await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["penguin"]));
	});
});

describe("external invocation terminal in the session", () => {
	it("opens the tab after send, scrolls to that output, confirms a running close, and clears only a finished view", async () => {
		const user = userEvent.setup();
		const stop = vi.fn();
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async () => ({ invocationId: "inv-1" }),
			stop,
			subscribe: (_sessionId, next) => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
		};
		render(
			<ExternalInvocationTerminalSession
				session={{ sessionId: "session-1", cwd: "/work/app" }}
				client={client}
				prompt="fix the test"
				onPromptChange={() => undefined}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		await act(async () => {
			listener?.({ type: "running", invocationId: "inv-1", prompt: "fix the test", agentId: "grok" });
		});
		const panel = await screen.findByRole("region", { name: "外部调用" });
		expect(within(panel).getByRole("button", { name: "Grok" }).getAttribute("aria-current")).toBe("true");
		expect((screen.getByRole("button", { name: "清屏" }) as HTMLButtonElement).disabled).toBe(true);

		await user.click(screen.getByRole("button", { name: "关闭标签" }));
		expect(screen.getByRole("dialog", { name: "停止这次调用？" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "停止" }));
		expect(stop).toHaveBeenCalledWith("inv-1");
		expect(screen.queryByRole("region", { name: "外部调用" })).toBeNull();

		await act(async () => {
			listener?.({ type: "output", invocationId: "inv-1", chunk: "HEAD" });
			listener?.({ type: "truncated", invocationId: "inv-1", discardedBytes: 12 });
			listener?.({ type: "output", invocationId: "inv-1", chunk: "TAIL" });
			listener?.({ type: "completed", invocationId: "inv-1", exitCode: 0 });
		});
		await user.click(screen.getByRole("button", { name: "在终端查看" }));
		const replay = screen.getByText(/HEAD/);
		expect(replay.textContent).toContain("中间省略了 12 字节");
		expect(replay.textContent).toContain("TAIL");
		expect(replay.getAttribute("data-scroll-target")).toBe("inv-1");
		expect((screen.getByRole("button", { name: "清屏" }) as HTMLButtonElement).disabled).toBe(false);
		await user.click(screen.getByRole("button", { name: "清屏" }));
		expect(document.querySelector("pre")?.textContent).toBe("");
		await user.click(screen.getByRole("button", { name: "在终端查看" }));
		expect(screen.getByText(/HEAD/).textContent).toContain("TAIL");
		await user.click(screen.getByRole("button", { name: "关闭标签" }));
		expect(screen.queryByRole("dialog", { name: "停止这次调用？" })).toBeNull();
		expect(screen.queryByRole("region", { name: "外部调用" })).toBeNull();
	});
});
