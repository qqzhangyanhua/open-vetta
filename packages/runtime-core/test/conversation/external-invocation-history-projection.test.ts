import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
	EXTERNAL_INVOCATION_CUSTOM_TYPE,
	projectConversationDocumentHistory,
	selectConversationDocumentModelMessages,
} from "../../src/conversation/index.js";

describe("external invocation history projection", () => {
	it("projects the latest custom entry for an invocation and leaves it out of the model message sequence", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: { role: "user", content: "ask penguin", timestamp: 1 },
				timestamp: 1,
			},
			1,
		);
		document = applyConversationDocumentCommand(document, {
			type: "custom.append",
			entryId: "ext-running",
			customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
			timestamp: "2026-09-24T06:00:01.000Z",
			data: {
				invocationId: "inv-1",
				agentId: "grok",
				prompt: "fix the test",
				status: "running",
				exitCode: null,
				failureReason: null,
				discardedBytes: 0,
			},
		}).document;
		document = applyConversationDocumentCommand(document, {
			type: "custom.append",
			entryId: "ext-done",
			customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
			timestamp: "2026-09-24T06:00:02.000Z",
			data: {
				invocationId: "inv-1",
				agentId: "grok",
				prompt: "fix the test",
				status: "completed",
				exitCode: 0,
				failureReason: null,
				discardedBytes: 12,
			},
		}).document;

		expect(projectConversationDocumentHistory(document)).toEqual([
			expect.objectContaining({ type: "message", message: expect.objectContaining({ content: "ask penguin" }) }),
			{
				type: "external_invocation",
				invocationId: "inv-1",
				agentId: "grok",
				prompt: "fix the test",
				status: "completed",
				exitCode: 0,
				failureReason: null,
				discardedBytes: 12,
				timestamp: "2026-09-24T06:00:02.000Z",
			},
		]);
		expect(selectConversationDocumentModelMessages(document).map((message) => message.content)).toEqual([
			"ask penguin",
		]);
	});
});
