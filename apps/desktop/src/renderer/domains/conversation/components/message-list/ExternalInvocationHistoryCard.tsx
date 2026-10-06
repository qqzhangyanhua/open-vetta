import { Button } from "@shared/components/ui/button";
import type { ChatTimelineEventViewModel } from "@shared/store/atoms";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { externalAgentLabel } from "../external-invocation/external-agent-label";

const externalInvocationStatusKey = {
	queued: "externalInvocation.status.queued",
	running: "externalInvocation.status.running",
	completed: "externalInvocation.status.completed",
	failed: "externalInvocation.status.failed",
} as const;

/** Read-only record of a call to an external agent. The terminal action is supplied by the session. */
export const ExternalInvocationHistoryCard = memo(function ExternalInvocationHistoryCard({
	event,
	onViewInTerminal,
}: {
	event: Extract<ChatTimelineEventViewModel, { kind: "external_invocation" }>;
	onViewInTerminal?: () => void;
}) {
	const { t } = useTranslation("chat");
	const agent = externalAgentLabel(event.agentId, t) || event.agentId;
	return (
		<article aria-label={`${agent} ${event.prompt}`}>
			<p>{event.prompt}</p>
			<p>
				{event.status === "interrupted"
					? t(
							event.interruptReason === "app-exit"
								? "externalInvocation.status.interruptedAppExit"
								: event.interruptReason === "cancelled"
									? "externalInvocation.status.interruptedCancelled"
									: "externalInvocation.status.interruptedUser",
						)
					: t(externalInvocationStatusKey[event.status])}
			</p>
			{event.exitCode !== null ? <p>{t("externalInvocation.exitCode", { code: event.exitCode })}</p> : null}
			{event.status !== "interrupted" && event.failureReason ? <p>{event.failureReason}</p> : null}
			{onViewInTerminal ? (
				<Button type="button" variant="ghost" size="sm" onClick={onViewInTerminal}>
					{t("externalInvocation.viewInTerminal")}
				</Button>
			) : null}
		</article>
	);
});
