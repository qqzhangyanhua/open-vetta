// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExternalInvocationPage, type ExternalInvocationClient, type ExternalInvocationClientEvent } from "./SessionExternalInvocationPage";

beforeEach(async () => {
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
