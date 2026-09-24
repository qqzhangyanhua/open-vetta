// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalInvocationTerminalSession } from "./ExternalInvocationTerminalSession";
import { activeInputDraftKeyAtom } from "@shared/store/atoms";
import { clearExternalHistoryResumes } from "@shared/store/external-history-resume";
import { clearExternalRecipients } from "@shared/store/external-recipient";
import { DefaultSessionRowView } from "@vetta-org/theme-ui/project";
import { getDefaultStore } from "jotai";
import { useExternalHistoryResumeOffer } from "@shared/hooks/useExternalHistoryResumeOffer";
import { SessionExternalInvocationPage, type ExternalInvocationClient, type ExternalInvocationClientEvent } from "./SessionExternalInvocationPage";

beforeEach(async () => {
	clearExternalRecipients();
	clearExternalHistoryResumes();
	getDefaultStore().set(activeInputDraftKeyAtom, null);
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
		expect(screen.getByText("第一条交给 Grok 打开它的终端，之后直接在终端里接着聊")).toBeTruthy();
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
			externalSessionId: null,
			newSession: false,
		});
		await act(async () => {
			listener?.({ type: "running", invocationId: "inv-1", prompt: "fix the test", agentId: "grok" });
		});
		expect(screen.getByText("运行中")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "发给 Grok" })).toBeNull();
		expect(screen.getByText("在终端里继续对话")).toBeTruthy();
		expect(screen.queryByLabelText("消息")).toBeNull();
		await act(async () => {
			listener?.({ type: "completed", invocationId: "inv-1", exitCode: 0 });
		});
		await waitFor(() => expect(screen.getByText("已完成")).toBeTruthy());
		expect(screen.getByText("退出码 0")).toBeTruthy();
		expect(screen.getByRole("button", { name: "发给 Grok" })).toBeTruthy();
		expect(screen.getByLabelText("消息")).toBeTruthy();
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

	it("shows OMP in 发给 when it is detected and omits it when it is not", async () => {
		const detected: ExternalInvocationClient = {
			listAgents: async () => [{ id: "omp", label: "OMP" }],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		const { unmount } = render(<Harness client={detected} />);
		await waitFor(() => expect(screen.getByRole("option", { name: "OMP" })).toBeTruthy());
		unmount();
		const missing: ExternalInvocationClient = {
			listAgents: async () => [],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		render(<Harness client={missing} />);
		await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["penguin"]));
		expect(screen.queryByRole("option", { name: "OMP" })).toBeNull();
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

	it("hides 开新会话 until a Grok session exists to continue", async () => {
		const user = userEvent.setup();
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: vi.fn(async () => ({ invocationId: "inv-1" })),
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
		expect(screen.queryByRole("button", { name: "开新会话" })).toBeNull();
		await user.type(screen.getByLabelText("消息"), "fix the test");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		await act(async () => {
			listener?.({
				type: "running",
				invocationId: "inv-1",
				prompt: "fix the test",
				agentId: "grok",
				externalSessionId: "sess-9",
			});
		});
		expect(screen.getByRole("button", { name: "开新会话" })).toBeTruthy();
	});

	it("creates a Vetta session then sends to Grok from the new session page", async () => {
		const user = userEvent.setup();
		const start = vi.fn(async () => ({ invocationId: "inv-1" }));
		const ensureSession = vi.fn(async () => ({ sessionId: "session-new", cwd: "/work/app" }));
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start,
			subscribe: () => () => undefined,
		};
		function NewSessionHarness(): JSX.Element {
			const [prompt, setPrompt] = useState("");
			return (
				<SessionExternalInvocationPage
					session={null}
					client={client}
					prompt={prompt}
					onPromptChange={setPrompt}
					showPrompt
					penguinTools={null}
					ensureSession={ensureSession}
				/>
			);
		}
		render(<NewSessionHarness />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect(screen.getByText("由 Grok 自己的权限设置决定，需要确认时会在终端里询问")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "开新会话" })).toBeNull();
		await user.type(screen.getByLabelText("消息"), "fix from new session");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		await waitFor(() => expect(ensureSession).toHaveBeenCalledOnce());
		expect(start).toHaveBeenCalledWith({
			sessionId: "session-new",
			cwd: "/work/app",
			prompt: "fix from new session",
			agentId: "grok",
			referencedPaths: [],
			externalSessionId: null,
			newSession: false,
		});
	});

	it("does not send to Grok on the new session page without a way to create a session", async () => {
		const user = userEvent.setup();
		const start = vi.fn();
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start,
			subscribe: () => () => undefined,
		};
		function NewSessionHarness(): JSX.Element {
			const [prompt, setPrompt] = useState("fix");
			return (
				<SessionExternalInvocationPage
					session={null}
					client={client}
					prompt={prompt}
					onPromptChange={setPrompt}
					showPrompt
					penguinTools={null}
				/>
			);
		}
		render(<NewSessionHarness />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect((screen.getByRole("button", { name: "发给 Grok" }) as HTMLButtonElement).disabled).toBe(true);
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).not.toHaveBeenCalled();
	});

	it("keeps the input bar to the switcher without stacking cards or permission copy", async () => {
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
		function Compact(): JSX.Element {
			const [prompt, setPrompt] = useState("hi");
			return (
				<SessionExternalInvocationPage
					session={{ sessionId: "session-1", cwd: "/work/app" }}
					client={client}
					prompt={prompt}
					onPromptChange={setPrompt}
					showPrompt={false}
					penguinTools={null}
				/>
			);
		}
		render(<Compact />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect(screen.queryByText("由 Grok 自己的权限设置决定，需要确认时会在终端里询问")).toBeNull();
		expect((screen.getByLabelText("发给") as HTMLSelectElement).title).toBe(
			"由 Grok 自己的权限设置决定，需要确认时会在终端里询问",
		);
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenCalledOnce();
		await act(async () => {
			listener?.({
				type: "running",
				invocationId: "inv-1",
				prompt: "hi",
				agentId: "grok",
				ordinal: 1,
				externalSessionId: "sess-9",
			});
		});
		expect(screen.queryByText("第 1 次")).toBeNull();
		expect(screen.queryByText("运行中")).toBeNull();
		expect(screen.queryByRole("button", { name: "在终端查看" })).toBeNull();
		expect(screen.queryByRole("button", { name: "发给 Grok" })).toBeNull();
		expect(screen.getByText("在终端里继续对话")).toBeTruthy();
		expect(screen.getByRole("button", { name: "开新会话" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "开新会话" }));
		expect(screen.getByRole("button", { name: "发给 Grok" })).toBeTruthy();
		expect(screen.queryByText("在终端里继续对话")).toBeNull();
	});

	it("header switcher only shows 发给, not send or 开新会话", async () => {
		const user = userEvent.setup();
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: vi.fn(),
			subscribe: () => () => undefined,
		};
		render(
			<SessionExternalInvocationPage
				session={{ sessionId: "session-1", cwd: "/work/app" }}
				client={client}
				prompt=""
				onPromptChange={() => undefined}
				showPrompt={false}
				switcherOnly
				penguinTools={null}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		expect(screen.queryByRole("button", { name: "发给 Grok" })).toBeNull();
		expect(screen.queryByRole("button", { name: "开新会话" })).toBeNull();
		expect(screen.queryByText("在终端里继续对话")).toBeNull();
	});

	it("does not hide the Grok composer because a different agent is running", async () => {
		const user = userEvent.setup();
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		const client: ExternalInvocationClient = {
			listAgents: async () => [
				{ id: "grok", label: "Grok", processForm: "interactive" },
				{ id: "omp", label: "OMP", processForm: "one-shot" },
			],
			start: vi.fn(),
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
		await act(async () => {
			listener?.({
				type: "running",
				invocationId: "inv-omp",
				prompt: "from omp",
				agentId: "omp",
			});
		});
		expect(screen.getByRole("button", { name: "发给 Grok" })).toBeTruthy();
		expect(screen.getByLabelText("消息")).toBeTruthy();
		expect(screen.queryByText("在终端里继续对话")).toBeNull();
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

	it("keeps a running invocation when switching away and restores the card and terminal on return", async () => {
		const user = userEvent.setup();
		const listeners = new Map<string, Set<(event: ExternalInvocationClientEvent) => void>>();
		const runningListeners = new Set<(sessionIds: readonly string[]) => void>();
		const saved = new Map<string, { sessionId: string; status: ExternalInvocationClientEvent; chunks: string[] }>();
		let running = new Set<string>();
		function publishRunning(): void {
			const ids = [...running];
			for (const listener of runningListeners) listener(ids);
		}
		function emit(sessionId: string, event: ExternalInvocationClientEvent): void {
			if (event.type === "running") {
				running = new Set(running).add(sessionId);
				publishRunning();
				saved.set(event.invocationId, { sessionId, status: event, chunks: [] });
			}
			if (event.type === "output") {
				const current = saved.get(event.invocationId);
				if (current) current.chunks.push(event.chunk ?? "");
			}
			for (const listener of listeners.get(sessionId) ?? []) listener(event);
		}
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async () => ({ invocationId: "inv-1" }),
			subscribe(sessionId, listener) {
				const set = listeners.get(sessionId) ?? new Set();
				set.add(listener);
				listeners.set(sessionId, set);
				for (const item of saved.values()) {
					if (item.sessionId !== sessionId) continue;
					listener(item.status);
					if (item.chunks.length > 0) {
						listener({ type: "output", invocationId: item.status.invocationId, chunk: item.chunks.join("") });
					}
				}
				return () => set.delete(listener);
			},
			subscribeRunning(listener) {
				runningListeners.add(listener);
				listener([...running]);
				return () => runningListeners.delete(listener);
			},
		};
		function Switcher(): JSX.Element {
			const [session, setSession] = useState({ sessionId: "session-a", cwd: "/work/app" });
			const [runningIds, setRunningIds] = useState<readonly string[]>([]);
			return (
				<>
					<nav aria-label="会话">
						<span>会话 A{runningIds.includes("session-a") ? " 运行中" : ""}</span>
						<button type="button" onClick={() => setSession({ sessionId: "session-b", cwd: "/work/fresh" })}>
							新会话
						</button>
						<button type="button" onClick={() => setSession({ sessionId: "session-a", cwd: "/work/app" })}>
							回到会话 A
						</button>
					</nav>
					<ExternalInvocationRunningWatch client={client} onChange={setRunningIds} />
					<ExternalInvocationTerminalSession
						session={session}
						client={client}
						prompt="fix the test"
						onPromptChange={() => undefined}
					/>
				</>
			);
		}
		render(<Switcher />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		act(() => {
			emit("session-a", { type: "running", invocationId: "inv-1", prompt: "fix the test", agentId: "grok" });
			emit("session-a", { type: "output", invocationId: "inv-1", chunk: "before " });
		});
		expect(screen.getByRole("navigation", { name: "会话" }).textContent).toContain("运行中");
		expect(screen.getByRole("region", { name: "外部调用" }).querySelector("pre")?.textContent).toContain("before");
		await user.click(screen.getByRole("button", { name: "新会话" }));
		expect(screen.queryByRole("region", { name: "外部调用" })).toBeNull();
		expect(screen.getByRole("navigation", { name: "会话" }).textContent).toContain("运行中");
		act(() => {
			emit("session-a", { type: "output", invocationId: "inv-1", chunk: "away " });
		});
		await user.click(screen.getByRole("button", { name: "回到会话 A" }));
		expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
		const replay = await screen.findByRole("region", { name: "外部调用" });
		expect(replay.querySelector("pre")?.textContent).toContain("before");
		expect(replay.querySelector("pre")?.textContent).toContain("away");
		act(() => {
			emit("session-a", { type: "output", invocationId: "inv-1", chunk: "live" });
		});
		expect(screen.getByRole("region", { name: "外部调用" }).querySelector("pre")?.textContent).toContain("live");
	});

	it("appends a follow-up to the same tab with a separator, and a new session opens another tab", async () => {
		const user = userEvent.setup();
		const start = vi.fn(async (_request: Parameters<ExternalInvocationClient["start"]>[0]) => ({
			invocationId: "inv-1",
		}));
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		let n = 1;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async (request) => {
				start(request);
				return { invocationId: `inv-${n}` };
			},
			subscribe: (_sessionId, next) => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
		};
		function Prompt(): JSX.Element {
			const [prompt, setPrompt] = useState("fix the test");
			return (
				<ExternalInvocationTerminalSession
					session={{ sessionId: "session-1", cwd: "/work/app" }}
					client={client}
					prompt={prompt}
					onPromptChange={setPrompt}
				/>
			);
		}
		render(<Prompt />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		await act(async () => {
			listener?.({ type: "running", invocationId: "inv-1", prompt: "fix the test", agentId: "grok", ordinal: 1 });
			listener?.({ type: "output", invocationId: "inv-1", chunk: "first" });
			listener?.({
				type: "completed",
				invocationId: "inv-1",
				exitCode: 0,
				externalSessionId: "sess-9",
				ordinal: 1,
			});
		});
		n = 2;
		await user.clear(screen.getByLabelText("消息"));
		await user.type(screen.getByLabelText("消息"), "and the lint");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ externalSessionId: "sess-9", newSession: false }));
		await act(async () => {
			listener?.({
				type: "running",
				invocationId: "inv-2",
				prompt: "and the lint",
				agentId: "grok",
				ordinal: 2,
				externalSessionId: "sess-9",
				startedAt: "2026-09-24T06:05:00.000Z",
			});
			listener?.({ type: "output", invocationId: "inv-2", chunk: "second" });
		});
		const panel = screen.getByRole("region", { name: "外部调用" });
		expect(within(panel).getAllByRole("button", { name: "Grok" })).toHaveLength(1);
		const transcript = panel.querySelector("pre")?.textContent ?? "";
		expect(transcript).toContain("first");
		expect(transcript).toContain("第 2 次 · 2026-09-24T06:05:00.000Z · 运行中");
		expect(transcript).toContain("second");
		expect(screen.getAllByText("第 2 次").length).toBeGreaterThan(0);

		n = 3;
		await user.click(screen.getByRole("button", { name: "开新会话" }));
		await user.clear(screen.getByLabelText("消息"));
		await user.type(screen.getByLabelText("消息"), "start over");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ newSession: true, externalSessionId: null }));
		await act(async () => {
			listener?.({ type: "running", invocationId: "inv-3", prompt: "start over", agentId: "grok", ordinal: 1 });
		});
		expect(within(screen.getByRole("region", { name: "外部调用" })).getAllByRole("button", { name: "Grok" })).toHaveLength(2);
	});

	it("cancels a queued card before it starts", async () => {
		const user = userEvent.setup();
		const stop = vi.fn();
		let listener: ((event: ExternalInvocationClientEvent) => void) | undefined;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async () => ({ invocationId: "inv-2" }),
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
				prompt="wait"
				onPromptChange={() => undefined}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.selectOptions(screen.getByLabelText("发给"), "grok");
		await act(async () => {
			listener?.({
				type: "queued",
				invocationId: "inv-2",
				prompt: "wait",
				agentId: "grok",
				ordinal: 2,
			});
		});
		expect(screen.getByText("排队中")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(stop).toHaveBeenCalledWith("inv-2");
	});

	it("resumes from history into the current session, and a row click only opens the read-only view", async () => {
		const user = userEvent.setup();
		const start = vi.fn(async () => ({ invocationId: "inv-1" }));
		const onOpenViewer = vi.fn();
		getDefaultStore().set(activeInputDraftKeyAtom, "session-1");
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				externalInvocations: {
					recordedDirectoryExists: async (cwd: string) => cwd !== "/gone",
				},
			},
		});
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start,
			subscribe: () => () => undefined,
		};
		function Flow({ cwd }: { cwd: string }): JSX.Element {
			const [prompt, setPrompt] = useState("");
			return (
				<>
					<HistoryRow cwd={cwd} onOpenViewer={onOpenViewer} />
					<SessionExternalInvocationPage
						session={{ sessionId: "session-1", cwd: "/work/app" }}
						client={client}
						draftKey="session-1"
						prompt={prompt}
						onPromptChange={setPrompt}
						showPrompt
						penguinTools={<span>模型</span>}
					/>
				</>
			);
		}
		const view = render(<Flow cwd="/work/other" />);
		await waitFor(() => expect(screen.getByRole("option", { name: "Grok" })).toBeTruthy());
		await user.click(screen.getByRole("button", { name: "Fix the login bug" }));
		expect(onOpenViewer).toHaveBeenCalledOnce();
		expect(start).not.toHaveBeenCalled();
		expect(screen.queryByText("续跑：Fix the login bug")).toBeNull();
		await user.click(await screen.findByRole("button", { name: "在当前会话里用 Grok 续跑" }));
		expect(start).not.toHaveBeenCalled();
		expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("grok");
		expect(screen.getByText("续跑：Fix the login bug")).toBeTruthy();
		expect(screen.getByText("将在 /work/other 中续跑")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "关闭续跑" }));
		expect(screen.queryByText("续跑：Fix the login bug")).toBeNull();
		await user.click(await screen.findByRole("button", { name: "在当前会话里用 Grok 续跑" }));
		await user.type(screen.getByLabelText("消息"), "keep going");
		await user.click(screen.getByRole("button", { name: "发给 Grok" }));
		expect(start).toHaveBeenCalledWith({
			sessionId: "session-1",
			cwd: "/work/other",
			prompt: "keep going",
			agentId: "grok",
			referencedPaths: [],
			externalSessionId: "sess-9",
			newSession: false,
			historyResume: { externalSessionId: "sess-9", cwd: "/work/other" },
		});
		view.rerender(<Flow cwd="/gone" />);
		await waitFor(() =>
			expect((screen.getByRole("button", { name: "在当前会话里用 Grok 续跑不可用：目录已不存在" }) as HTMLButtonElement).disabled).toBe(
				true,
			),
		);
	});
});

function ExternalInvocationRunningWatch({
	client,
	onChange,
}: {
	client: ExternalInvocationClient;
	onChange: (sessionIds: readonly string[]) => void;
}): null {
	useEffect(() => client.subscribeRunning?.(onChange), [client, onChange]);
	return null;
}

function HistoryRow({ cwd, onOpenViewer }: { cwd: string; onOpenViewer: () => void }): JSX.Element {
	const offer = useExternalHistoryResumeOffer({
		id: "sess-9",
		cwd,
		name: "Fix the login bug",
		firstMessage: "Fix the login bug",
		origin: { tool: "grok", path: "/tmp/grok/summary.json" },
	});
	return (
		<>
			<DefaultSessionRowView
				active={false}
				contextMenuEnabled
				label="Fix the login bug"
				renaming={false}
				running={false}
				scheduled={false}
				moreLabel="更多"
				onOpenContextMenu={() => undefined}
				onRename={() => undefined}
				onRenameDone={() => undefined}
				onSelect={onOpenViewer}
			/>
			{offer.visible ? (
				<button type="button" disabled={offer.disabled} onClick={offer.onSelect}>
					{offer.label}
				</button>
			) : null}
		</>
	);
}
