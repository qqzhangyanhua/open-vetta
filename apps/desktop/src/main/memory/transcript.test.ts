import type { ConversationDocument, ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { memoryTranscriptEntries } from "./transcript.js";

describe("memory transcript", () => {
	it("uses the compression summary for the dropped prefix and keeps the current branch", () => {
		const document = conversation(
			[
				message("old", null, "user", "dropped raw request"),
				message("kept", "old", "user", "kept request"),
				message("side", "old", "user", "other branch"),
				compaction("summary", "kept", "kept", "earlier work"),
				message("tool", "summary", "toolResult", "tool payload"),
				message("after", "tool", "assistant", "after compaction"),
			],
			"after",
		);

		expect(memoryTranscriptEntries(document)).toEqual([
			{ id: "summary", text: "SUMMARY: earlier work" },
			{ id: "kept", text: "USER: kept request" },
			{ id: "after", text: "ASSISTANT: after compaction" },
		]);
	});

	it("reads the whole branch when nothing has been compressed", () => {
		const document = conversation(
			[message("ask", null, "user", "where do I live"), message("answer", "ask", "assistant", "Kunshan")],
			"answer",
		);
		expect(memoryTranscriptEntries(document).map((entry) => entry.text)).toEqual([
			"USER: where do I live",
			"ASSISTANT: Kunshan",
		]);
	});
});

function conversation(entries: readonly ConversationDocumentEntry[], activeLeafId: string): ConversationDocument {
	return {
		identity: { sessionId: "session-1", createdAt: 0 },
		journalVersion: entries.length,
		revision: entries.length,
		entries,
		activeLeafId,
	};
}

function message(
	id: string,
	parentId: string | null,
	role: "user" | "assistant" | "toolResult",
	text: string,
): ConversationDocumentEntry {
	return {
		id,
		parentId,
		timestamp: "2026-10-28T00:00:00.000Z",
		type: "message",
		message: { role, content: text, timestamp: 1 },
	};
}

function compaction(
	id: string,
	parentId: string,
	firstKeptEntryId: string,
	summary: string,
): ConversationDocumentEntry {
	return {
		id,
		parentId,
		timestamp: "2026-10-28T00:00:01.000Z",
		type: "compaction",
		summary,
		firstKeptEntryId,
		tokensBefore: 10,
	};
}
