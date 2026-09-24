import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface ExternalInvocationAgentOption {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
}

export interface ExternalInvocationImage {
	readonly path: string;
	readonly name: string;
}

export interface ExternalInvocationCardModel {
	readonly invocationId: string;
	readonly agentLabel: string;
	readonly prompt: string;
	readonly statusLabel: string;
	readonly exitCode: number | null;
	readonly failureReason: string | null;
	readonly ordinal: number;
	readonly queued: boolean;
}

export interface SessionExternalInvocationModel {
	readonly agents: readonly ExternalInvocationAgentOption[];
	readonly recipientId: string;
	readonly onRecipientChange: (agentId: string) => void;
	readonly placeholder: string;
	readonly permissionNote: string;
	readonly sendLabel: string;
	readonly prompt: string;
	readonly onPromptChange: (value: string) => void;
	readonly showPrompt: boolean;
	readonly onSend: () => void;
	readonly cards: readonly ExternalInvocationCardModel[];
	readonly onViewInTerminal?: (invocationId: string) => void;
	readonly images: readonly ExternalInvocationImage[];
	readonly onRemoveImage: (path: string) => void;
	readonly imageRejectedLabel: string;
	readonly remoteNote: string | null;
	readonly sendBlocked: boolean;
	readonly newSession: boolean;
	readonly onNewSession: () => void;
	readonly onCancel: (invocationId: string) => void;
	readonly historyResume: { readonly title: string; readonly directoryNote: string | null } | null;
	readonly onDismissResume: () => void;
}

export function SessionExternalInvocationView({
	model,
	penguinTools,
	skills,
}: {
	readonly model: SessionExternalInvocationModel;
	readonly penguinTools: ReactNode;
	readonly skills?: ReactNode;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const external = model.recipientId !== "penguin";
	return (
		<section aria-label={model.sendLabel}>
			<label>
				{t("externalInvocation.switcher")}
				<select
					aria-label={t("externalInvocation.switcher")}
					value={model.recipientId}
					onChange={(event) => model.onRecipientChange(event.target.value)}
				>
					{model.agents.map((agent) => (
						<option key={agent.id} value={agent.id} disabled={agent.disabled}>
							{agent.label}
						</option>
					))}
				</select>
			</label>
			{model.remoteNote ? <p>{model.remoteNote}</p> : null}
			{external ? null : (skills ?? null)}
			{external ? (
				<>
					{model.showPrompt ? <p>{model.placeholder}</p> : null}
					<p>{model.permissionNote}</p>
					{model.historyResume ? (
						<p>
							<span>{t("externalInvocation.resume.capsule", { title: model.historyResume.title })}</span>
							{model.historyResume.directoryNote ? <span>{model.historyResume.directoryNote}</span> : null}
							<button type="button" onClick={model.onDismissResume}>
								{t("externalInvocation.resume.dismiss")}
							</button>
						</p>
					) : null}
					{model.images.length > 0 ? (
						<ul>
							{model.images.map((image) => (
								<li key={image.path}>
									<span>{image.name}</span>
									<span>{model.imageRejectedLabel}</span>
									<button type="button" onClick={() => model.onRemoveImage(image.path)}>
										{t("inputBar.capsule.removeImage")}
									</button>
								</li>
							))}
						</ul>
					) : null}
					{model.showPrompt ? (
						<textarea aria-label={t("externalInvocation.message")} value={model.prompt} onChange={(event) => model.onPromptChange(event.target.value)} />
					) : null}
					<button type="button" aria-pressed={model.newSession} onClick={model.onNewSession}>
						{t("externalInvocation.newSession")}
					</button>
					<button type="button" disabled={model.sendBlocked} onClick={model.onSend}>
						{model.sendLabel}
					</button>
				</>
			) : (
				penguinTools
			)}
			{model.cards.map((card) => (
				<article key={card.invocationId} aria-label={`${card.agentLabel} ${card.prompt}`}>
					<p>{card.prompt}</p>
					<p>{t("externalInvocation.ordinal", { n: card.ordinal })}</p>
					<p>{card.statusLabel}</p>
					{card.queued ? (
						<button type="button" onClick={() => model.onCancel(card.invocationId)}>
							{t("externalInvocation.cancel")}
						</button>
					) : null}
					{card.exitCode !== null ? <p>{t("externalInvocation.exitCode", { code: card.exitCode })}</p> : null}
					{card.failureReason ? <p>{card.failureReason}</p> : null}
					{model.onViewInTerminal ? (
						<button type="button" onClick={() => model.onViewInTerminal?.(card.invocationId)}>
							{t("externalInvocation.viewInTerminal")}
						</button>
					) : null}
				</article>
			))}
		</section>
	);
}
