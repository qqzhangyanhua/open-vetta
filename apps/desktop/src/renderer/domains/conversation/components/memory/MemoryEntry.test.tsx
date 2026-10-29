// @vitest-environment jsdom

import type { DesktopMemoryApi } from "@/shared/memory";
import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { i18n, initI18n } from "@shared/i18n";
import { getShortcutScopeStack } from "@shared/shortcuts";
import { activeSessionAtom, contextUsageAtom, isCompactingAtom } from "@shared/store/atoms";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { atom, getDefaultStore } from "jotai";
import { useMemo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationFeedContext, createConversationFeed } from "../../conversation-view/feed";
import { ConversationMessageScope } from "../../conversation-view/message-scope";
import { SessionAgentMessage } from "../../session-conversation/SessionAgentMessage";
import { CommandPanel } from "../command-panel/CommandPanel";
import { sessionMemoryElements } from "./sessionMemoryElements";
import { MemoryReviewStartProvider, useMemoryReviewModel } from "./useMemoryReviewModel";

vi.mock("../../hooks/useSkillList", () => ({ useSkillList: () => ({ items: [] }) }));
vi.mock("../../hooks/useConnectorGrid", () => ({ useConnectorGrid: () => ({ items: [], columns: 4 }) }));
vi.mock("../../hooks/useSkillIconMap", () => ({
	useSkillIconMap: () => new Map(),
	skillIconOf: () => undefined,
}));
vi.mock("../useInputActionBarModel", () => ({
	useInputActionBarModel: () => ({ builtins: [], items: [], actions: { toggleItem: vi.fn() } }),
}));

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(async () => {
	getShortcutScopeStack().resetForTests();
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
	const store = getDefaultStore();
	store.set(activeSessionAtom, { cwd: "/workspace", runtimeId: "runtime-1", sessionPath: "/session.jsonl" });
	store.set(contextUsageAtom, null);
	store.set(isCompactingAtom, false);
	store.set(messageQueueBySessionAtom, new Map());
	initI18n();
	await i18n.changeLanguage("zh");
});

afterEach(() => {
	cleanup();
	getShortcutScopeStack().resetForTests();
	vi.unstubAllGlobals();
});

function ReviewHarness({ children }: { readonly children: ReactNode }): JSX.Element {
	const client = useMemo<DesktopMemoryApi>(
		() => ({
			listGlobal: async () => [],
			listProjects: async () => [],
			generate: () => new Promise(() => undefined),
			save: async () => [],
			getReadEnabled: async () => true,
			setReadEnabled: async (enabled) => enabled,
			getProjectReadEnabled: async () => true,
			setProjectReadEnabled: async (enabled) => enabled,
			getModelOverride: async () => null,
			setModelOverride: async () => undefined,
			listModels: async () => [],
			updateEntry: async () => undefined,
			deleteEntry: async () => undefined,
		}),
		[],
	);
	const model = useMemoryReviewModel("runtime-1", client);
	return (
		<MemoryReviewStartProvider start={model.actions.start}>
			{sessionMemoryElements(model).panel}
			{children}
		</MemoryReviewStartProvider>
	);
}

function AgentRows({
	items,
	streaming,
}: {
	readonly items: readonly ChatConversationItem[];
	readonly streaming: boolean;
}): JSX.Element {
	const feed = useMemo(
		() =>
			createConversationFeed({
				key: "session",
				items: atom(items),
				streaming: atom(streaming),
				workspace: { id: "/repo", cwd: "/repo", runtimeIds: ["runtime-1"] },
			}),
		[items, streaming],
	);
	return (
		<ConversationFeedContext.Provider value={feed}>
			{items.map((message, index) =>
				message.kind === "agent" ? (
					<div key={message.id} data-testid={`reply-${message.id}`}>
						<ConversationMessageScope
							row={{ message, index, isTail: index === items.length - 1, isLastUserMessage: false }}
						>
							<SessionAgentMessage />
						</ConversationMessageScope>
					</div>
				) : null,
			)}
		</ConversationFeedContext.Provider>
	);
}

function reply(id: string, text: string, phase: "completed" | "streaming" = "completed") {
	return createConversationAgentMessage({
		id,
		text,
		phase,
		blocks: [{ type: "text", id: `text-${id}`, text }],
	});
}

function SlashEntry({
	filter,
	onSend,
}: {
	readonly filter: string;
	readonly onSend: (text: string) => void;
}): JSX.Element {
	return (
		<>
			<input
				aria-label="消息"
				defaultValue={filter}
				onKeyDown={(event) => {
					if (event.key === "Enter") onSend(filter);
				}}
			/>
			<CommandPanel
				open
				filter={filter}
				onClose={() => undefined}
				onSelect={() => undefined}
				onSelectConnector={() => undefined}
			/>
		</>
	);
}

describe("记忆审阅入口", () => {
	it("/memory 打开审阅面板，并且不会把这句发给助手", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<ReviewHarness>
				<SlashEntry filter="/memory" onSend={onSend} />
			</ReviewHarness>,
		);

		screen.getByRole("textbox", { name: "消息" }).focus();
		await user.keyboard("{Enter}");

		expect(await screen.findByRole("region", { name: "审阅记忆" })).toBeTruthy();
		expect(screen.getByText("正在通读这个会话…")).toBeTruthy();
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(["/me", "/mem", "/记忆"])("%s 打开审阅面板，并且不会把这句发给助手", async (filter) => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<ReviewHarness>
				<SlashEntry filter={filter} onSend={onSend} />
			</ReviewHarness>,
		);

		screen.getByRole("textbox", { name: "消息" }).focus();
		await user.keyboard("{Enter}");

		expect(await screen.findByRole("region", { name: "审阅记忆" })).toBeTruthy();
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(["/m", "/compact"])("%s 仍是压缩上下文，不会打开审阅", async (filter) => {
		const user = userEvent.setup();
		const queueContextCompaction = vi.fn(async () => ({
			status: "queued" as const,
			id: "compact-1",
			pendingCount: 1,
		}));
		vi.stubGlobal("vetta", { session: { queueContextCompaction } });
		const onSend = vi.fn();
		render(
			<ReviewHarness>
				<SlashEntry filter={filter} onSend={onSend} />
			</ReviewHarness>,
		);

		expect(screen.getByRole("button", { name: /压缩上下文/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /从这次会话里提出可保存的记忆/ })).toBeNull();
		screen.getByRole("textbox", { name: "消息" }).focus();
		await user.keyboard("{Enter}");

		expect(queueContextCompaction).toHaveBeenCalledWith("runtime-1");
		expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(["/r", "/忆"])("%s 不插入生成记忆", async (filter) => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<ReviewHarness>
				<SlashEntry filter={filter} onSend={onSend} />
			</ReviewHarness>,
		);

		expect(screen.queryByRole("button", { name: /生成记忆|从这次会话里提出可保存的记忆/ })).toBeNull();
		screen.getByRole("textbox", { name: "消息" }).focus();
		await user.keyboard("{Enter}");
		expect(screen.queryByRole("region", { name: "审阅记忆" })).toBeNull();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("点命令面板里的生成记忆也会打开同一个面板，不会发消息", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<ReviewHarness>
				<SlashEntry filter="/memory" onSend={onSend} />
			</ReviewHarness>,
		);

		await user.click(screen.getByRole("button", { name: /从这次会话里提出可保存的记忆/ }));

		expect(await screen.findByRole("region", { name: "审阅记忆" })).toBeTruthy();
		expect(screen.getAllByRole("region", { name: "审阅记忆" })).toHaveLength(1);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("生成记忆只出现在最后一条已经结束的回复上", () => {
		const { rerender } = render(
			<ReviewHarness>
				<AgentRows items={[reply("older", "上一轮"), reply("live", "还在写", "streaming")]} streaming />
			</ReviewHarness>,
		);
		expect(screen.queryByRole("button", { name: "生成记忆" })).toBeNull();

		rerender(
			<ReviewHarness>
				<AgentRows
					items={[reply("older", "上一轮"), createConversationUserMessage({ id: "next", text: "继续" })]}
					streaming
				/>
			</ReviewHarness>,
		);
		expect(screen.queryByRole("button", { name: "生成记忆" })).toBeNull();

		rerender(
			<ReviewHarness>
				<AgentRows items={[reply("older", "上一轮"), reply("latest", "这一轮")]} streaming={false} />
			</ReviewHarness>,
		);
		expect(within(screen.getByTestId("reply-latest")).getByRole("button", { name: "生成记忆" })).toBeTruthy();
		expect(within(screen.getByTestId("reply-older")).queryByRole("button", { name: "生成记忆" })).toBeNull();
	});

	it("纯工具调用结束的一轮也可以生成记忆，并打开审阅面板", async () => {
		const user = userEvent.setup();
		render(
			<ReviewHarness>
				<AgentRows
					items={[
						reply("older", "上一轮"),
						createConversationAgentMessage({
							id: "tools",
							text: "",
							phase: "completed",
							blocks: [
								{
									type: "tool_call",
									toolCallId: "call-1",
									toolName: "bash",
									args: {},
									status: "success",
									result: "done",
								},
							],
						}),
					]}
					streaming={false}
				/>
			</ReviewHarness>,
		);

		expect(within(screen.getByTestId("reply-older")).queryByRole("button", { name: "生成记忆" })).toBeNull();
		const generate = within(screen.getByTestId("reply-tools")).getByRole("button", { name: "生成记忆" });
		await user.click(generate);
		expect(await screen.findByRole("region", { name: "审阅记忆" })).toBeTruthy();
		expect(screen.getByText("正在通读这个会话…")).toBeTruthy();
	});
});
