// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SessionExternalInvocationView,
	type SessionExternalInvocationModel,
} from "../external-invocation/SessionExternalInvocationView";
import {
	InputBarAttachmentActions,
	InputBarSendAction,
	InputBarSpeechAction,
} from "./InputBarToolbar";
import { InputBarToolbar, InputBarTrailingActions } from "./InputBarToolbarActions";
import type { InputBarModel } from "./types";

vi.mock("./InputBarToolbarButton", () => ({
	InputBarToolbarButton: ({ title, onClick }: { title: string; onClick: () => void }) => (
		<button type="button" onClick={onClick}>
			{title}
		</button>
	),
}));
vi.mock("../SendButton", () => ({
	SendButton: ({ onSend, canSend }: { onSend: () => void; canSend: boolean }) => (
		<button type="button" disabled={!canSend} onClick={onSend}>
			Send
		</button>
	),
}));

afterEach(cleanup);

function toolbarModel(overrides: Partial<Record<keyof InputBarModel, unknown>> = {}): InputBarModel {
	return {
		commands: undefined,
		sendingExternally: false,
		hasSession: true,
		labels: {
			toolbar: { skills: "Skills", addImage: "Add image", attachFile: "Attach file", queue: "Queue" },
			capsule: { removeDefault: "Remove", activeGroup: (count: number) => `${count}` },
		},
		leadingTools: [],
		activeActions: [],
		trailingTools: [],
		speechInput: null,
		canSend: true,
		sendBehavior: "queueable",
		isEmpty: true,
		isStreaming: false,
		actions: {
			handleAbort: () => undefined,
			handleSend: () => undefined,
			handleSelectFiles: () => undefined,
			handleSelectImages: () => undefined,
		},
		...overrides,
	} as unknown as InputBarModel;
}

function invocationModel(recipientId: "penguin" | "grok"): SessionExternalInvocationModel {
	const label = recipientId === "penguin" ? "penguin" : "Grok";
	return {
		agents: [
			{ id: "penguin", label: "penguin" },
			{ id: "grok", label: "Grok" },
		],
		recipientId,
		onRecipientChange: () => undefined,
		placeholder: "",
		permissionNote: "由 Grok 自己的权限设置决定",
		sendLabel: `发给 ${label}`,
		prompt: "hi",
		onPromptChange: () => undefined,
		showPrompt: false,
		switcherOnly: false,
		hideComposer: false,
		onSend: () => undefined,
		cards: [],
		images: [],
		onRemoveImage: () => undefined,
		imageRejectedLabel: "",
		remoteNote: null,
		sendBlocked: false,
		newSession: false,
		canStartNewSession: false,
		onNewSession: () => undefined,
		onCancel: () => undefined,
		historyResume: null,
		onDismissResume: () => undefined,
	};
}

function part(name: "toolbar-leading" | "toolbar-trailing"): HTMLElement {
	const element = document.querySelector(`[data-message-input-part="${name}"]`);
	if (!(element instanceof HTMLElement)) throw new Error(`missing ${name}`);
	return element;
}

describe("InputBar toolbar abilities", () => {
	it("keeps image and file attachment actions independently callable", () => {
		const onSelectImages = vi.fn();
		const onSelectFiles = vi.fn();
		render(
			<InputBarAttachmentActions
				disabled={false}
				visible
				addImageTitle="Add image"
				attachFileTitle="Attach file"
				onSelectImages={onSelectImages}
				onSelectFiles={onSelectFiles}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add image" }));
		fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
		expect(onSelectImages).toHaveBeenCalledOnce();
		expect(onSelectFiles).toHaveBeenCalledOnce();
	});

	it("renders speech input only when that ability is available", () => {
		const onToggle = vi.fn();
		const input = {
			visible: false,
			active: false,
			disabled: false,
			title: "Dictate",
			statusText: null,
			onToggle,
		};
		const view = render(<InputBarSpeechAction input={input} />);
		expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();

		view.rerender(<InputBarSpeechAction input={{ ...input, visible: true }} />);
		fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
		expect(onToggle).toHaveBeenCalledOnce();
	});

	it("preserves queue and normal send actions as separate states", () => {
		const onSend = vi.fn();
		const view = render(
			<InputBarSendAction
				canSend
				isEmpty={false}
				isStreaming
				queueTitle="Queue"
				onAbort={vi.fn()}
				onSend={onSend}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Queue" }));
		expect(onSend).toHaveBeenCalledOnce();

		view.rerender(
			<InputBarSendAction
				canSend
				isEmpty
				isStreaming={false}
				queueTitle="Queue"
				onAbort={vi.fn()}
				onSend={onSend}
			/>,
		);
		expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
	});
});

describe("input bar recipient placement", () => {
	beforeEach(async () => {
		initI18n();
		await i18n.changeLanguage("zh");
	});

	it("puts 发给 beside the permission controls and keeps an external send button on the right", () => {
		const view = render(
			<InputBarToolbar model={toolbarModel()}>
				<SessionExternalInvocationView model={invocationModel("penguin")} penguinTools={null} />
				<span>Grok 4.6</span>
			</InputBarToolbar>,
		);

		const switcher = screen.getByRole("button", { name: "发给" });
		expect(part("toolbar-leading").contains(switcher)).toBe(true);
		expect(part("toolbar-trailing").contains(switcher)).toBe(false);
		expect(part("toolbar-trailing").contains(screen.getByText("Grok 4.6"))).toBe(true);

		view.rerender(
			<InputBarToolbar model={toolbarModel()}>
				<SessionExternalInvocationView model={invocationModel("grok")} penguinTools={null} />
				<span>Grok 4.6</span>
			</InputBarToolbar>,
		);

		expect(part("toolbar-leading").contains(screen.getByRole("button", { name: "发给" }))).toBe(true);
		expect(screen.queryByRole("button", { name: "发给 Grok" })).toBeNull();
		expect(part("toolbar-trailing").contains(screen.getByRole("button", { name: "Send" }))).toBe(true);
	});

	it("sends to an external recipient with the same round button, and hides it while the terminal continues the chat", () => {
		const onEditorSend = vi.fn();
		const onHandleSend = vi.fn();
		const ready = toolbarModel({
			sendingExternally: true,
			canSendExternally: true,
			externalInvocation: { hideComposer: false, onEditorSend },
			actions: {
				handleAbort: () => undefined,
				handleSend: onHandleSend,
				handleSelectFiles: () => undefined,
				handleSelectImages: () => undefined,
			},
		});
		const view = render(<InputBarTrailingActions model={ready} />);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(onEditorSend).toHaveBeenCalledOnce();
		expect(onHandleSend).not.toHaveBeenCalled();

		view.rerender(
			<InputBarTrailingActions
				model={toolbarModel({
					sendingExternally: true,
					canSendExternally: false,
					externalInvocation: { hideComposer: false, onEditorSend },
				})}
			/>,
		);
		expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

		view.rerender(
			<InputBarTrailingActions
				model={toolbarModel({
					sendingExternally: true,
					canSendExternally: true,
					externalInvocation: { hideComposer: true, onEditorSend },
				})}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
	});
});
