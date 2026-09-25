// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DefaultChatView } from "./DefaultChatView";

const workspace = { id: "conversation:test", cwd: null, runtimeIds: [] };

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	ActivityPanel: () => createElement("aside", { "data-testid": "activity-panel" }),
	CurrentScenarioActivityPanel: () => createElement("aside", { "data-testid": "activity-panel" }),
}));

vi.mock("@domains/bottom-panel/components/BottomPanelHost", () => ({
	BottomPanelHost: ({ fill }: { fill?: boolean }) =>
		createElement("section", {
			"data-testid": "bottom-panel",
			"data-fill": fill ? "true" : "false",
		}),
}));

vi.mock("../ChatExportHost", () => ({
	ChatExportHost: () => null,
}));

describe("DefaultChatView external terminal surface", () => {
	it("keeps the same bottom panel instance when Grok fills the main area", () => {
		const { rerender } = render(
			<DefaultChatView messages={[]} workspace={workspace}>
				<div data-testid="message-list" />
			</DefaultChatView>,
		);
		const panel = screen.getByTestId("bottom-panel");
		expect(panel.getAttribute("data-fill")).toBe("false");

		rerender(
			<DefaultChatView surface="external-terminal" messages={[]} workspace={workspace}>
				{null}
			</DefaultChatView>,
		);
		expect(screen.getByTestId("bottom-panel")).toBe(panel);
		expect(panel.getAttribute("data-fill")).toBe("true");
		expect(screen.queryByTestId("input-bar")).toBeNull();
		expect(screen.queryByTestId("activity-panel")).toBeNull();
	});
});
