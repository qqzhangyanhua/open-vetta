import { pathBasename } from "@shared/lib/utils";
import { activeSessionAtom, dispatchBottomPanelAtom } from "@shared/store/atoms";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const AGENT_LABEL_KEY = {
	grok: "externalInvocation.agent.grok",
	omp: "externalInvocation.agent.omp",
	"cursor-agent": "externalInvocation.agent.cursorAgent",
	agy: "externalInvocation.agent.agy",
	codex: "externalInvocation.agent.codex",
	pi: "externalInvocation.agent.pi",
	droid: "externalInvocation.agent.droid",
	opencode: "externalInvocation.agent.opencode",
} as const;

function agentMenuLabel(
	id: string,
	fallback: string,
	t: (key: (typeof AGENT_LABEL_KEY)[keyof typeof AGENT_LABEL_KEY]) => string,
): string {
	if (Object.hasOwn(AGENT_LABEL_KEY, id)) return t(AGENT_LABEL_KEY[id as keyof typeof AGENT_LABEL_KEY]) || fallback;
	return fallback;
}

export interface ExternalAgentMenuItem {
	readonly id: string;
	readonly agentId: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly disabledReason?: string;
	pick(): void;
}

export function useExternalAgentMenuItems(): readonly ExternalAgentMenuItem[] {
	const { t } = useTranslation("chat");
	const session = useAtomValue(activeSessionAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtom);
	const [agents, setAgents] = useState<readonly { id: string; label: string }[]>([]);

	useEffect(() => {
		const api = window.vetta?.externalInvocations;
		if (!api) return;
		let cancelled = false;
		void api.listAgents().then((listed) => {
			if (!cancelled) setAgents(listed);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return useMemo(() => {
		const remote = Boolean(session?.cwd && isSshProjectUri(session.cwd));
		const remoteReason = t("externalInvocation.remoteUnsupported");
		const noSession = !session;
		return agents.map((agent) => {
			const disabled = remote || noSession;
			const label = agentMenuLabel(agent.id, agent.label, t);
			return {
				id: `external-agent:${agent.id}`,
				agentId: agent.id,
				label,
				disabled,
				disabledReason: remote ? remoteReason : undefined,
				pick() {
					if (disabled || !session) return;
					const api = window.vetta?.externalInvocations;
					if (!api) return;
					void api
						.start({
							sessionId: session.runtimeId,
							cwd: session.cwd,
							prompt: "",
							agentId: agent.id,
							newSession: true,
						})
						.then(({ invocationId }) => {
							dispatch({
								type: "open-external-invocation",
								tabId: invocationId,
								newLeafId: `leaf-${invocationId}`,
								payload: {
									invocationId,
									status: "running",
									agentLabel: label,
									projectLabel: pathBasename(session.cwd),
									sessionId: session.runtimeId,
								},
							});
						});
				},
			};
		});
	}, [agents, dispatch, session, t]);
}
