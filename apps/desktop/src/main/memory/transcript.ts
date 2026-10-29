import {
	type ConversationDocument,
	type ConversationDocumentEntry,
	selectConversationDocumentBranch,
} from "@vetta/runtime-core/conversation";

export interface MemoryTranscriptEntry {
	readonly id: string;
	readonly text: string;
}

/**
 * Current branch text for memory extraction.
 * The newest compaction summary replaces entries before its firstKeptEntryId,
 * matching the model-visible window rather than the raw dropped messages.
 */
export function memoryTranscriptEntries(document: ConversationDocument): MemoryTranscriptEntry[] {
	const parts: MemoryTranscriptEntry[] = [];
	for (const entry of memoryVisibleBranch(selectConversationDocumentBranch(document))) {
		if (entry.type === "compaction") {
			const summary = entry.summary.trim();
			if (summary) parts.push({ id: entry.id, text: `SUMMARY: ${summary}` });
			continue;
		}
		if (entry.type !== "message" || entry.origin?.kind === "continuation") continue;
		const message = entry.message;
		if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant")) continue;
		const text = messageText(message.content);
		if (!text) continue;
		const role = message.role === "assistant" ? "ASSISTANT" : "USER";
		parts.push({ id: entry.id, text: `${role}: ${text}` });
	}
	return parts;
}

function memoryVisibleBranch(branch: readonly ConversationDocumentEntry[]): readonly ConversationDocumentEntry[] {
	let compactionIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "compaction" && entry.summary.trim() && entry.firstKeptEntryId) {
			compactionIndex = index;
			break;
		}
	}
	if (compactionIndex < 0) return branch;
	const compaction = branch[compactionIndex];
	if (!compaction || compaction.type !== "compaction") return branch;
	const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	if (firstKeptIndex < 0) throw new Error("memory:session-unavailable");
	const kept = branch.filter((_, index) => index !== compactionIndex && index >= firstKeptIndex);
	return [compaction, ...kept];
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (typeof block !== "object" || block === null || !("type" in block)) return [];
			if (block.type === "text" && "text" in block && typeof block.text === "string") return [block.text];
			return [];
		})
		.join("\n")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
