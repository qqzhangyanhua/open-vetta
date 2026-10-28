import { launchExternalHistoryResumeTerminal } from "@domains/conversation/components/external-invocation/launch-history-resume-terminal";
import { activeInputDraftKeyAtom, type SessionInfo } from "@shared/store/atoms";
import {
	bindExternalHistoryResume,
	historyResumeFromSession,
	revealExternalHistoryResume,
} from "@shared/store/external-history-resume";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
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
	const draftKey = useAtomValue(activeInputDraftKeyAtom);
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
		void Promise.resolve()
			.then(() => window.vetta.externalInvocations.recordedDirectoryExists(cwd))
			.then(
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
	const noSession = draftKey === null;
	return {
		visible: record !== null,
		label: missing
			? t("externalInvocation.resume.unavailable", { agent })
			: noSession
				? t("externalInvocation.resume.inTerminal", { agent })
				: t("externalInvocation.resume.action", { agent }),
		disabled: exists !== true,
		onSelect: () => {
			if (!record || exists !== true) return;
			if (!draftKey) {
				launchExternalHistoryResumeTerminal(record, agent);
				return;
			}
			bindExternalHistoryResume(draftKey, record);
			revealExternalHistoryResume(draftKey);
		},
	};
}

function agentLabel(agentId: string | undefined, t: TFunction<"chat">): string {
	if (agentId === "grok") return t("externalInvocation.agent.grok");
	if (agentId === "omp") return t("externalInvocation.agent.omp");
	if (agentId === "cursor-agent") return t("externalInvocation.agent.cursorAgent");
	return "";
}
