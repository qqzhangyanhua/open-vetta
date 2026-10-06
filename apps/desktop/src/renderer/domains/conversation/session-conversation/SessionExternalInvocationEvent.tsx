import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { externalAgentLabel } from "../components/external-invocation/external-agent-label";
import { openExternalInvocationTabAtom } from "../components/external-invocation/open-external-invocation-tab";
import { ExternalInvocationHistoryCard } from "../components/message-list/ExternalInvocationHistoryCard";
import { useEventMessage } from "../conversation-view/event-message";

/** Live session's external-agent record, with a button that reopens its terminal. */
export function SessionExternalInvocationEvent() {
	const event = useEventMessage("SessionExternalInvocationEvent");
	const { t } = useTranslation("chat");
	const session = useAtomValue(activeSessionAtom);
	const openTab = useSetAtom(openExternalInvocationTabAtom);
	if (event.kind !== "external_invocation") return null;
	const agent = externalAgentLabel(event.agentId, t) || event.agentId;
	return (
		<ExternalInvocationHistoryCard
			event={event}
			onViewInTerminal={
				session
					? () =>
							openTab({
								scopeKey: session.sessionPath,
								invocationId: event.invocationId,
								status: event.status === "running" || event.status === "queued" ? "running" : "finished",
								cwd: session.cwd,
								sessionId: session.runtimeId,
								agentLabel: agent,
								agentId: event.agentId,
							})
					: undefined
			}
		/>
	);
}
