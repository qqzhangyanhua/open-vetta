// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { activeInputDraftKeyAtom, openSessionFnRef, sessionContextMenuAtom, sessionsMapAtom } from "@shared/store/atoms";
import { clearExternalInvocationOrigins } from "@shared/store/external-invocation-origins";
import { clearExternalHistoryResumes } from "@shared/store/external-history-resume";
import { clearExternalRecipients } from "@shared/store/external-recipient";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAtomValue, useSetAtom } from "jotai";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContextMenu } from "../../../project/components/SessionContextMenu";
import { DefaultSessionList } from "../../../project/components/sidebar/projects/panel/DefaultSessionList";
import type { SidebarConversationInfo } from "../../../project/services/sidebar-conversation-projection";
import {
	SessionExternalInvocationPage,
	type ExternalInvocationClient,
	type ExternalInvocationClientEvent,
} from "./SessionExternalInvocationPage";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@vetta-org/ui", () => ({
	cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
	Button: ({
		children,
		disabled,
		onClick,
		type = "button",
	}: {
		children: ReactNode;
		disabled?: boolean;
		onClick?: () => void;
		type?: "button" | "submit";
	}) => (
		<button type={type} disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
	DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: () => null,
	DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
	DropdownMenuItem: ({
		children,
		onSelect,
		disabled,
	}: {
		children: ReactNode;
		onSelect?: () => void;
		disabled?: boolean;
	}) => (
		<button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect?.()}>
			{children}
		</button>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
		<button type="button" role="menuitem">
			{children}
		</button>
	),
	DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
}));

const DRAFT = "/work/vetta-1.jsonl";
let originDropped = false;

function externalSession(id: string, name: string): SidebarConversationInfo {
	return {
		kind: "conversation",
		id,
		path: `/tmp/grok/${id}/summary.json`,
		cwd: "/work/other",
		name,
		firstMessage: name,
		modifiedAt: Date.now() - 60_000,
		origin: { tool: "grok", path: `/tmp/grok/${id}/summary.json` },
		access: { readHistory: true, resume: false, rename: false, delete: false },
	};
}

function MenuHost(): JSX.Element | null {
	const menu = useAtomValue(sessionContextMenuAtom);
	const setMenu = useSetAtom(sessionContextMenuAtom);
	if (!menu) return null;
	return <SessionContextMenu {...menu} onClose={() => setMenu(null)} onDelete={() => undefined} />;
}

beforeEach(async () => {
	originDropped = false;
	clearExternalRecipients();
	clearExternalHistoryResumes();
	clearExternalInvocationOrigins();
	const store = (await import("jotai")).getDefaultStore();
	store.set(activeInputDraftKeyAtom, DRAFT);
	store.set(sessionContextMenuAtom, null);
	store.set(
		sessionsMapAtom,
		new Map([
			[
				"/work",
				[
					{
						id: "vetta-1",
						path: DRAFT,
						cwd: "/work",
						firstMessage: "hello",
						modifiedAt: 1,
					},
				],
			],
		]),
	);
	openSessionFnRef.current = null;
	initI18n();
	await i18n.changeLanguage("zh");
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			externalInvocations: {
				recordedDirectoryExists: async () => true,
				origins: async () =>
					originDropped
						? []
						: [{ externalSessionId: "sess-9", sessionId: "vetta-1", invocationId: "inv-1" }],
			},
			shell: { showInFolder: () => undefined },
		},
	});
});

afterEach(() => {
	openSessionFnRef.current = null;
	cleanup();
});

describe("penguin-initiated external history", () => {
	it("marks rows started by penguin, offers a jump back, and resumes inside that session without a capsule", async () => {
		const user = userEvent.setup();
		const openSession = vi.fn(async () => undefined);
		openSessionFnRef.current = openSession;
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async () => ({ invocationId: "inv-1" }),
			subscribe: () => () => undefined,
		};
		function Flow(): JSX.Element {
			const [prompt, setPrompt] = useState("");
			return (
				<>
					<DefaultSessionList
						activeSessionPath=""
						activeTeamSessionId=""
						cwd="/tmp/grok"
						filter="external"
						loading={false}
						onRenameSession={() => undefined}
						onSelectSession={() => undefined}
						scrollParent={null}
						sessions={[externalSession("sess-9", "Fix the login bug"), externalSession("sess-else", "Wrote this in Grok")]}
					/>
					<MenuHost />
					<SessionExternalInvocationPage
						session={{ sessionId: "vetta-1", cwd: "/work" }}
						client={client}
						draftKey={DRAFT}
						prompt={prompt}
						onPromptChange={setPrompt}
						showPrompt
						penguinTools={<span>模型</span>}
					/>
				</>
			);
		}
		render(<Flow />);
		await waitFor(() => expect(screen.getByRole("button", { name: /Fix the login bug/ }).textContent).toContain("由 penguin 发起"));
		expect(screen.getByRole("button", { name: /Wrote this in Grok/ }).textContent).not.toContain("由 penguin 发起");

		const elsewhere = screen.getByRole("button", { name: /Wrote this in Grok/ }).parentElement;
		if (!elsewhere) throw new Error("missing row");
		await user.click(within(elsewhere).getByRole("button", { name: "更多" }));
		expect(screen.queryByRole("menuitem", { name: "打开发起它的会话" })).toBeNull();

		const started = screen.getByRole("button", { name: /Fix the login bug/ }).parentElement;
		if (!started) throw new Error("missing row");
		await user.click(within(started).getByRole("button", { name: "更多" }));
		await user.click(await screen.findByRole("menuitem", { name: "打开发起它的会话" }));
		expect(openSession).toHaveBeenCalledWith("/work", DRAFT);

		await user.click(within(started).getByRole("button", { name: "更多" }));
		await waitFor(() =>
			expect(
				(screen.getByRole("menuitem", { name: "在当前会话里用 Grok 续跑" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);
		await user.click(screen.getByRole("menuitem", { name: "在当前会话里用 Grok 续跑" }));
		expect(screen.queryByText("续跑：Fix the login bug")).toBeNull();
		await waitFor(() => expect((screen.getByLabelText("发给") as HTMLSelectElement).value).toBe("grok"));

		originDropped = true;
		const store = (await import("jotai")).getDefaultStore();
		store.set(sessionsMapAtom, new Map());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Fix the login bug/ }).textContent).not.toContain("由 penguin 发起"),
		);
		await user.click(within(started).getByRole("button", { name: "更多" }));
		expect(screen.queryByRole("menuitem", { name: "打开发起它的会话" })).toBeNull();
	});

	it("shows the penguin marker after the run finishes, without remounting the sidebar", async () => {
		let located = false;
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				externalInvocations: {
					recordedDirectoryExists: async () => true,
					origins: async () =>
						located ? [{ externalSessionId: "sess-9", sessionId: "vetta-1", invocationId: "inv-1" }] : [],
				},
			},
		});
		const subscriber: { emit: ((event: ExternalInvocationClientEvent) => void) | null } = { emit: null };
		const client: ExternalInvocationClient = {
			listAgents: async () => [{ id: "grok", label: "Grok" }],
			start: async () => ({ invocationId: "inv-1" }),
			subscribe: (_sessionId, listener) => {
				subscriber.emit = listener;
				return () => {
					subscriber.emit = null;
				};
			},
		};
		function Flow(): JSX.Element {
			const [prompt, setPrompt] = useState("");
			return (
				<>
					<DefaultSessionList
						activeSessionPath=""
						activeTeamSessionId=""
						cwd="/tmp/grok"
						filter="external"
						loading={false}
						onRenameSession={() => undefined}
						onSelectSession={() => undefined}
						scrollParent={null}
						sessions={[externalSession("sess-9", "Fix the login bug")]}
					/>
					<SessionExternalInvocationPage
						session={{ sessionId: "vetta-1", cwd: "/work" }}
						client={client}
						draftKey={DRAFT}
						prompt={prompt}
						onPromptChange={setPrompt}
						showPrompt
						penguinTools={<span>模型</span>}
					/>
				</>
			);
		}
		render(<Flow />);
		await waitFor(() => expect(screen.getByRole("button", { name: /Fix the login bug/ })).toBeTruthy());
		expect(screen.getByRole("button", { name: /Fix the login bug/ }).textContent).not.toContain("由 penguin 发起");
		located = true;
		if (!subscriber.emit) throw new Error("missing subscriber");
		subscriber.emit({ type: "completed", invocationId: "inv-1", agentId: "grok", externalSessionId: "sess-9" });
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Fix the login bug/ }).textContent).toContain("由 penguin 发起"),
		);
	});
});
