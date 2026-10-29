import type { HistoryEntry } from "@vetta/runtime-core";

/** Current session text for memory extraction. Tool payloads stay out; compaction summaries stay in. */
export function serializeMemoryTranscript(history: readonly HistoryEntry[]): string {
	const parts: string[] = [];
	for (const entry of history) {
		if (entry.type === "compaction") {
			const summary = entry.summary.trim();
			if (summary) parts.push(`SUMMARY: ${summary}`);
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = messageText(message.content);
		if (text) parts.push(`${message.role.toUpperCase()}: ${text}`);
	}
	return parts.join("\n\n");
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
