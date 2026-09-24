import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	SessionExternalInvocationView,
	type ExternalInvocationCardModel,
	type ExternalInvocationAgentOption,
} from "./SessionExternalInvocationView";

const externalInvocationStatusKey = {
	running: "externalInvocation.status.running",
	completed: "externalInvocation.status.completed",
	failed: "externalInvocation.status.failed",
} as const;

export interface ExternalInvocationClientEvent {
	readonly type: "running" | "completed" | "failed" | "output" | "truncated";
	readonly invocationId: string;
	readonly prompt?: string;
	readonly agentId?: string;
	readonly exitCode?: number | null;
	readonly reason?: string;
	readonly chunk?: string;
	readonly discardedBytes?: number;
}

export interface ExternalInvocationClient {
	listAgents(): Promise<readonly { id: "grok"; label: string }[]>;
	start(request: { sessionId: string; cwd: string; prompt: string; agentId: string }): Promise<{ invocationId: string }>;
	subscribe(sessionId: string, listener: (event: ExternalInvocationClientEvent) => void): () => void;
	stop?(invocationId: string): void;
	writeInput?(invocationId: string, data: string): void;
}

export function applyExternalInvocationEvent(
	cards: readonly ExternalInvocationCardModel[],
	event: ExternalInvocationClientEvent,
	agentLabel: string,
	statusLabel: (status: "running" | "completed" | "failed") => string,
): readonly ExternalInvocationCardModel[] {
	if (event.type === "output" || event.type === "truncated") return cards;
	if (event.type === "running") {
		return [
			...cards.filter((card) => card.invocationId !== event.invocationId),
			{
				invocationId: event.invocationId,
				agentLabel,
				prompt: event.prompt ?? "",
				statusLabel: statusLabel("running"),
				exitCode: null,
				failureReason: null,
			},
		];
	}
	const status = event.type === "failed" ? "failed" : "completed";
	return cards.map((card) =>
		card.invocationId === event.invocationId
			? {
					...card,
					statusLabel: statusLabel(status),
					exitCode: event.exitCode ?? null,
					failureReason: event.reason ?? null,
				}
			: card,
	);
}

export function SessionExternalInvocationPage({
	session,
	client,
	prompt,
	onPromptChange,
	showPrompt,
	penguinTools,
	onRecipientChange,
	onViewInTerminal,
	onInvocationEvent,
}: {
	readonly session: { sessionId: string; cwd: string } | null;
	readonly client: ExternalInvocationClient | null;
	readonly prompt: string;
	readonly onPromptChange: (value: string) => void;
	readonly showPrompt: boolean;
	readonly penguinTools: ReactNode;
	readonly onRecipientChange?: (recipientId: string) => void;
	readonly onViewInTerminal?: (invocationId: string) => void;
	readonly onInvocationEvent?: (event: ExternalInvocationClientEvent) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [detected, setDetected] = useState<readonly { id: "grok"; label: string }[]>([]);
	const [recipientId, setRecipientId] = useState("penguin");
	useEffect(() => {
		onRecipientChange?.(recipientId);
	}, [onRecipientChange, recipientId]);
	const [cards, setCards] = useState<readonly ExternalInvocationCardModel[]>([]);
	const agents: ExternalInvocationAgentOption[] = [
		{ id: "penguin", label: t("externalInvocation.agent.penguin") },
		...detected.map((agent) => ({ id: agent.id, label: agent.label })),
	];
	const recipient = agents.find((agent) => agent.id === recipientId) ?? agents[0];
	const external = recipientId !== "penguin";

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		void client.listAgents().then((agents) => {
			if (!cancelled) setDetected(agents);
		});
		return () => {
			cancelled = true;
		};
	}, [client]);

	useEffect(() => {
		if (!client || !session) return;
		return client.subscribe(session.sessionId, (event) => {
			if (event.type === "output" || event.type === "truncated") {
				onInvocationEvent?.(event);
				return;
			}
			onInvocationEvent?.(event);
			const label = event.agentId === "grok" ? "Grok" : (recipient?.label ?? "");
			setCards((current) =>
				applyExternalInvocationEvent(current, event, label, (status) => t(externalInvocationStatusKey[status])),
			);
		});
	}, [client, recipient?.label, session, t]);

	return (
		<SessionExternalInvocationView
			model={{
				agents,
				recipientId,
				onRecipientChange: setRecipientId,
				placeholder: t("externalInvocation.placeholder", { agent: recipient?.label ?? "" }),
				permissionNote: t("externalInvocation.permission", { agent: recipient?.label ?? "" }),
				sendLabel: t("externalInvocation.sendLabel", { agent: recipient?.label ?? "" }),
				prompt,
				onPromptChange,
				showPrompt,
				onSend: () => {
					if (!external || !client || !session || prompt.trim().length === 0) return;
					void client.start({
						sessionId: session.sessionId,
						cwd: session.cwd,
						prompt,
						agentId: recipientId,
					});
					onPromptChange("");
				},
				cards,
				onViewInTerminal,
			}}
			penguinTools={penguinTools}
		/>
	);
}
