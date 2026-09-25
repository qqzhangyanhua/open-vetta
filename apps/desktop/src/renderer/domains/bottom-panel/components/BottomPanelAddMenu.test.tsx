// @vitest-environment jsdom

import { emptyBottomPanelState } from "@shared/store/atoms";
import { activeSessionAtom } from "@shared/store/chat-atoms";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BottomPanelComponentDefinition } from "../registry/types";
import { BottomPanelAddMenu } from "./BottomPanelAddMenu";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const terminal: BottomPanelComponentDefinition = {
	id: "terminal",
	source: "builtin",
	defaultMeta: { label: "终端", icon: "icon-[solar--command-linear]" },
	component: () => null,
};

describe("bottom panel add menu external agents", () => {
	const start = vi.fn(async () => ({ invocationId: "inv-1" }));

	beforeEach(() => {
		start.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				externalInvocations: {
					listAgents: async () => [{ id: "grok", label: "Grok" }],
					start,
				},
			},
		});
	});

	it("lists Grok under 内置 and starts a new session when picked", async () => {
		const user = userEvent.setup();
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/work/app", sessionPath: "/work/app.jsonl", runtimeId: "rt-1" });
		render(
			<Provider store={store}>
				<BottomPanelAddMenu definitions={[terminal]} state={emptyBottomPanelState()} onPick={() => undefined} />
			</Provider>,
		);
		await user.click(screen.getByLabelText("bottomPanel.actions.add"));
		await waitFor(() => expect(screen.getByText("externalInvocation.agent.grok")).toBeTruthy());
		const grok = screen.getByText("externalInvocation.agent.grok").closest("button");
		expect(grok?.querySelector("[aria-hidden]")).not.toBeNull();
		expect(grok?.querySelector("[class*='monitor']")).toBeNull();
		await user.click(screen.getByText("externalInvocation.agent.grok"));
		await waitFor(() =>
			expect(start).toHaveBeenCalledWith({
				sessionId: "rt-1",
				cwd: "/work/app",
				prompt: "",
				agentId: "grok",
				newSession: true,
			}),
		);
	});

	it("shows only the CLIs that listAgents found on PATH", async () => {
		const user = userEvent.setup();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				externalInvocations: {
					listAgents: async () => [
						{ id: "pi", label: "pi" },
						{ id: "droid", label: "droid" },
					],
					start,
				},
			},
		});
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/work/app", sessionPath: "/work/app.jsonl", runtimeId: "rt-1" });
		render(
			<Provider store={store}>
				<BottomPanelAddMenu definitions={[terminal]} state={emptyBottomPanelState()} onPick={() => undefined} />
			</Provider>,
		);
		await user.click(screen.getByLabelText("bottomPanel.actions.add"));
		await waitFor(() => expect(screen.getByText("externalInvocation.agent.pi")).toBeTruthy());
		expect(screen.getByText("externalInvocation.agent.pi").closest("button")?.querySelector("[aria-hidden]")).not.toBeNull();
		expect(screen.getByText("externalInvocation.agent.droid").closest("button")?.querySelector("[aria-hidden]")).not.toBeNull();
		expect(screen.queryByText("externalInvocation.agent.opencode")).toBeNull();
		expect(screen.queryByText("externalInvocation.agent.grok")).toBeNull();
	});
});

