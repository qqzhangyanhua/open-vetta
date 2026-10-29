import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { GenerateMemoryButton } from "../components/message-list/MessageActions";
import { useMemoryReviewStart } from "../components/memory/useMemoryReviewModel";
import { AgentMessage, useConversationFeed, useMessageRow } from "../conversation-view";

/**
 * A reply in the active session: its work and text, then copy, time, usage and
 * the next-prompt prediction status, then the cards it produced.
 */
export function SessionAgentMessage() {
	return (
		<AgentMessage.Root>
			<AgentMessage.Header />
			<AgentMessage.Fold />
			<div>
				<AgentMessage.Content />
			</div>
			<AgentMessage.StreamingIndicator />
			<AgentMessage.Actions>
				<AgentMessage.ActionBar>
					<AgentMessage.CopyAction />
					<SessionGenerateMemoryAction />
					<AgentMessage.Time />
					<AgentMessage.TokenUsage />
				</AgentMessage.ActionBar>
				<AgentMessage.PredictingStatus />
			</AgentMessage.Actions>
			<AgentMessage.Cards />
		</AgentMessage.Root>
	);
}

/**
 * Memory is for the whole session, so the control stays on the latest assistant
 * reply. A turn has a conclusion once streaming has stopped, including a
 * tool-only stop with no final text.
 */
function SessionGenerateMemoryAction() {
	const start = useMemoryReviewStart();
	const { t } = useTranslation("chat");
	const row = useMessageRow("SessionGenerateMemoryAction");
	const feed = useConversationFeed("SessionGenerateMemoryAction");
	const items = useAtomValue(feed.items);
	const streaming = useAtomValue(feed.streaming);
	const message = row.message;
	if (!start || message.kind !== "agent") return null;
	let lastAssistantId: string | null = null;
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item?.kind === "agent") {
			lastAssistantId = item.id;
			break;
		}
	}
	if (message.id !== lastAssistantId) return null;
	if (streaming || message.phase === "pending" || message.phase === "streaming") return null;
	return (
		<GenerateMemoryButton
			label={t("memoryReview.generate")}
			onGenerate={() => {
				void start();
			}}
		/>
	);
}
