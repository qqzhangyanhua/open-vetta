// @vitest-environment jsdom

import {
	activeSessionAtom,
	bottomPanelStateAtomFamily,
	dispatchBottomPanelAtomFamily,
	findBottomPanelTab,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { openLiveExternalInvocation } from "./open-external-invocation-tab";

const store = getDefaultStore();

function closePanel(scopeKey: string): void {
	const dispatch = dispatchBottomPanelAtomFamily(scopeKey);
	const root = store.get(bottomPanelStateAtomFamily(scopeKey)).root;
	if (root?.kind === "leaf") {
		for (const tab of root.tabs) store.set(dispatch, { type: "close-tab", tabId: tab.tabId });
	}
}

afterEach(() => {
	closePanel("/sessions/grok.jsonl");
	closePanel("agent-team:session-1");
	store.set(activeSessionAtom, null);
	store.set(pendingSessionOpenAtom, null);
});

describe("openLiveExternalInvocation", () => {
	it("opens the terminal on the session that was just created, not the new-session draft", () => {
		store.set(activeSessionAtom, {
			cwd: "/work/app",
			sessionPath: "/sessions/grok.jsonl",
			runtimeId: "rt-1",
		});
		openLiveExternalInvocation({
			fallbackCwd: "/draft",
			invocationId: "inv-1",
			status: "running",
			agentLabel: "Grok",
			agentId: "grok",
			createIfMissing: true,
		});
		const panel = store.get(bottomPanelStateAtomFamily("/sessions/grok.jsonl"));
		expect(panel.collapsed).toBe(false);
		expect(panel.filled).toBe(true);
		expect(findBottomPanelTab(panel.root, "inv-1")?.tab.payload).toMatchObject({
			invocationId: "inv-1",
			status: "running",
			sessionId: "rt-1",
			agentId: "grok",
			agentLabel: "Grok",
		});
		expect(store.get(bottomPanelStateAtomFamily("new:/work/app")).root).toBeNull();
	});

	it("does not open a terminal before the session exists", () => {
		openLiveExternalInvocation({
			fallbackCwd: "/work/app",
			invocationId: "inv-missing",
			status: "running",
			createIfMissing: true,
		});
		expect(store.get(bottomPanelStateAtomFamily("/work/app")).root).toBeNull();
	});

	it("keeps the terminal on the chat surface that is already open", () => {
		store.set(activeSessionAtom, {
			cwd: "/work/app",
			sessionPath: "/sessions/other.jsonl",
			runtimeId: "rt-2",
		});
		openLiveExternalInvocation({
			workSurfaceKey: "agent-team:session-1",
			fallbackCwd: "/work/app",
			invocationId: "inv-team",
			status: "running",
			agentLabel: "Grok",
			createIfMissing: true,
		});
		const panel = store.get(bottomPanelStateAtomFamily("agent-team:session-1"));
		expect(findBottomPanelTab(panel.root, "inv-team")).toBeTruthy();
		expect(panel.filled).toBe(true);
		expect(store.get(bottomPanelStateAtomFamily("/sessions/other.jsonl")).root).toBeNull();
	});

	it("does not force the main area open again once that terminal is already open", () => {
		store.set(activeSessionAtom, {
			cwd: "/work/app",
			sessionPath: "/sessions/grok.jsonl",
			runtimeId: "rt-1",
		});
		openLiveExternalInvocation({
			fallbackCwd: "/work/app",
			invocationId: "inv-1",
			status: "running",
			createIfMissing: true,
		});
		store.set(dispatchBottomPanelAtomFamily("/sessions/grok.jsonl"), { type: "set-filled", filled: false });
		openLiveExternalInvocation({
			fallbackCwd: "/work/app",
			invocationId: "inv-1",
			status: "running",
			createIfMissing: true,
		});
		expect(store.get(bottomPanelStateAtomFamily("/sessions/grok.jsonl")).filled).toBe(false);
	});
});
