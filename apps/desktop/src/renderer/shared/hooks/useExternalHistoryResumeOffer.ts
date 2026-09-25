import { useExternalInvocationOrigins } from "@shared/hooks/useExternalInvocationOrigins";
import type { SessionInfo } from "@shared/store/atoms";
import {
	bindExternalHistoryResume,
	currentDraftKey,
	historyResumeFromSession,
} from "@shared/store/external-history-resume";
import { externalInvocationOriginFor, vettaSessionIdFromDraftKey } from "@shared/store/external-invocation-origins";
import { rememberExternalRecipient } from "@shared/store/external-recipient";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ExternalHistoryResumeOffer {
	readonly visible: boolean;
	readonly label: string;
	readonly disabled: boolean;
	readonly onSelect: () => void;
}

export function useExternalHistoryResumeOffer(
	session: Pick<SessionInfo, "id" | "cwd" | "name" | "firstMessage" | "origin"> | null,
): ExternalHistoryResumeOffer {
	const { t } = useTranslation("chat");
	useExternalInvocationOrigins();
	const record = session ? historyResumeFromSession(session) : null;
	const cwd = record?.cwd ?? "";
	const [exists, setExists] = useState<boolean | null>(cwd.length > 0 ? null : false);
	useEffect(() => {
		if (!cwd) {
			setExists(false);
			return;
		}
		let cancelled = false;
		setExists(null);
		void window.vetta.externalInvocations.recordedDirectoryExists(cwd).then(
			(available) => {
				if (!cancelled) setExists(available);
			},
			() => {
				if (!cancelled) setExists(false);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [cwd]);
	const agent = agentLabel(record?.agentId, t);
	const missing = exists === false;
	return {
		visible: record !== null,
		label: missing
			? t("externalInvocation.resume.unavailable", { agent })
			: t("externalInvocation.resume.action", { agent }),
		disabled: exists !== true || currentDraftKey() === null,
		onSelect: () => {
			if (!record || exists !== true) return;
			const draftKey = currentDraftKey();
			if (!draftKey) return;
			const origin = externalInvocationOriginFor(record.externalSessionId);
			if (origin && vettaSessionIdFromDraftKey(draftKey) === origin.sessionId) {
				rememberExternalRecipient(draftKey, record.agentId);
				return;
			}
			bindExternalHistoryResume(draftKey, record);
		},
	};
}

function agentLabel(agentId: string | undefined, t: TFunction<"chat">): string {
	if (agentId === "grok") return t("externalInvocation.agent.grok");
	if (agentId === "omp") return t("externalInvocation.agent.omp");
	if (agentId === "cursor-agent") return t("externalInvocation.agent.cursorAgent");
	return "";
}
