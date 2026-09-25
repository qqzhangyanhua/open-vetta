// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import {
	activeInputDraftKeyAtom,
	activeSessionAtom,
	bottomPanelStateAtom,
	findBottomPanelTab,
} from "@shared/store/atoms";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultMessageItem } from "./MessageItem";
import type { ChatConversationItem } from "./types";

beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});

afterEach(() => cleanup());

describe("external invocation history card", () => {
	it("opens the terminal from the conversation card", async () => {
		const user = userEvent.setup();
		const store = createStore();
		store.set(activeInputDraftKeyAtom, "/sessions/s.jsonl");
		store.set(activeSessionAtom, {
			cwd: "/work/app",
			sessionPath: "/sessions/s.jsonl",
			runtimeId: "rt-1",
		});
		const message: ChatConversationItem = {
			kind: "event",
			id: "external-invocation-inv-1",
			timestamp: Date.parse("2026-09-24T06:00:00.000Z"),
			event: {
				kind: "external_invocation",
				invocationId: "inv-1",
				agentId: "grok",
				prompt: "fix the test",
				status: "completed",
				exitCode: 0,
				failureReason: null,
			},
		};
		render(
			<Provider store={store}>
				<DefaultMessageItem message={message} isStreaming={false} isTailMessage />
			</Provider>,
		);
		await user.click(screen.getByRole("button", { name: "在终端查看" }));
		const panel = store.get(bottomPanelStateAtom);
		expect(findBottomPanelTab(panel.root, "inv-1")?.tab.payload).toMatchObject({
			invocationId: "inv-1",
			status: "finished",
			sessionId: "rt-1",
		});
	});
});
