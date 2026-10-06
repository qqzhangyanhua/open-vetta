import type { ChatTimelineEventViewModel } from "@shared/store/chat-atoms";
import { createContext, type ReactNode, useContext } from "react";
import { ExternalInvocationHistoryCard } from "../components/message-list/ExternalInvocationHistoryCard";
import { TeamMemberReplyCard } from "../components/message-list/TeamMemberReplyCard";
import { CompactionBoundary, DelegationNotice, OmittedReasoningNote } from "../components/message-list/TimelineEventViews";
import { useConversationCapability } from "./feed";
import { useMessageRow } from "./message-scope";

const EventContext = createContext<ChatTimelineEventViewModel | null>(null);

export function useEventMessage(part: string): ChatTimelineEventViewModel {
	const event = useContext(EventContext);
	if (!event) throw new Error(`${part} must be rendered inside <EventMessage.Root>`);
	return event;
}

/** A timeline event in the row of the enclosing `<Conversation.EventMessage>` template. */
function EventMessageRoot({ children }: { readonly children?: ReactNode }) {
	const { message } = useMessageRow("EventMessage.Root");
	if (message.kind !== "event") return null;
	return <EventContext.Provider value={message.event}>{children}</EventContext.Provider>;
}

/** The boundary where earlier history was compacted into a summary. */
function EventMessageCompaction() {
	return useEventMessage("EventMessage.Compaction").kind === "compaction" ? <CompactionBoundary /> : null;
}

/** Reasoning turns omitted from an external transcript. */
function EventMessageOmittedReasoning() {
	const event = useEventMessage("EventMessage.OmittedReasoning");
	return event.kind === "omitted_reasoning" ? <OmittedReasoningNote count={event.count} /> : null;
}

/** A recorded call to an external agent. The live session supplies the terminal action. */
function EventMessageExternalInvocation() {
	const event = useEventMessage("EventMessage.ExternalInvocation");
	return event.kind === "external_invocation" ? <ExternalInvocationHistoryCard event={event} /> : null;
}

/** A task delegated to another agent. */
function EventMessageDelegation() {
	const event = useEventMessage("EventMessage.Delegation");
	return event.kind === "delegation" ? <DelegationNotice label={event.label} /> : null;
}

/**
 * A Team member's progress and reply. It links to the member's conversation
 * when the feed can open it.
 */
function EventMessageTeamMemberReply() {
	const event = useEventMessage("EventMessage.TeamMemberReply");
	const openTeamMember = useConversationCapability("openTeamMember");
	return event.kind === "team-member-summary" ? <TeamMemberReplyCard event={event} onOpen={openTeamMember} /> : null;
}

/** Every event kind with its standard presentation. */
function EventMessageBody() {
	return (
		<>
			<EventMessageCompaction />
			<EventMessageOmittedReasoning />
			<EventMessageExternalInvocation />
			<EventMessageDelegation />
			<EventMessageTeamMemberReply />
		</>
	);
}

/** Parts for `<Conversation.EventMessage>` templates (ADR-0147); each renders only its own kind. */
export const EventMessage = {
	Root: EventMessageRoot,
	Compaction: EventMessageCompaction,
	OmittedReasoning: EventMessageOmittedReasoning,
	ExternalInvocation: EventMessageExternalInvocation,
	Delegation: EventMessageDelegation,
	TeamMemberReply: EventMessageTeamMemberReply,
	Body: EventMessageBody,
} as const;
