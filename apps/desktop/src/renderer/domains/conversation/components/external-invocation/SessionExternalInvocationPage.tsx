import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { externalRecipientFor, rememberExternalRecipient } from "@shared/store/external-recipient";
import {
	SessionExternalInvocationView,
	type ExternalInvocationCardModel,
	type ExternalInvocationAgentOption,
	type ExternalInvocationImage,
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
	start(request: {
		sessionId: string;
		cwd: string;
		prompt: string;
		agentId: string;
		referencedPaths?: readonly string[];
	}): Promise<{ invocationId: string }>;
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
	draftKey = null,
	images = [],
	onRemoveImage,
	referencedPaths = [],
	remote = false,
	skills = null,
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
	readonly draftKey?: string | null;
	readonly images?: readonly ExternalInvocationImage[];
	readonly onRemoveImage?: (path: string) => void;
	readonly referencedPaths?: readonly string[];
	readonly remote?: boolean;
	readonly skills?: ReactNode;
	readonly onRecipientChange?: (recipientId: string) => void;
	readonly onViewInTerminal?: (invocationId: string) => void;
	readonly onInvocationEvent?: (event: ExternalInvocationClientEvent) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [detected, setDetected] = useState<readonly { id: "grok"; label: string }[]>([]);
	const [recipientId, setRecipientId] = useState(() => externalRecipientFor(draftKey));
	useEffect(() => {
		setRecipientId(externalRecipientFor(draftKey));
	}, [draftKey]);
	useEffect(() => {
		onRecipientChange?.(recipientId);
	}, [onRecipientChange, recipientId]);
	const [cards, setCards] = useState<readonly ExternalInvocationCardModel[]>([]);
	const agents: ExternalInvocationAgentOption[] = [
		{ id: "penguin", label: t("externalInvocation.agent.penguin") },
		...detected.map((agent) => ({ id: agent.id, label: agent.label, disabled: remote })),
	];
	const recipient = agents.find((agent) => agent.id === recipientId) ?? agents[0];
	const external = recipientId !== "penguin";
	const sendBlocked = images.length > 0 || remote;

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
				onRecipientChange: (next) => {
					rememberExternalRecipient(draftKey, next);
					setRecipientId(next);
				},
				placeholder: t("externalInvocation.placeholder", { agent: recipient?.label ?? "" }),
				permissionNote: t("externalInvocation.permission", { agent: recipient?.label ?? "" }),
				sendLabel: t("externalInvocation.sendLabel", { agent: recipient?.label ?? "" }),
				prompt,
				onPromptChange,
				showPrompt,
				onSend: () => {
					if (!external || sendBlocked || !client || !session || prompt.trim().length === 0) return;
					void client.start({
						sessionId: session.sessionId,
						cwd: session.cwd,
						prompt,
						agentId: recipientId,
						referencedPaths,
					});
					onPromptChange("");
				},
				cards,
				onViewInTerminal,
				images,
				onRemoveImage: (path) => onRemoveImage?.(path),
				imageRejectedLabel: t("externalInvocation.imageRejected", { agent: recipient?.label ?? "" }),
				remoteNote: remote ? t("externalInvocation.remoteUnsupported") : null,
				sendBlocked,
			}}
			skills={skills}
			penguinTools={penguinTools}
		/>
	);
}
