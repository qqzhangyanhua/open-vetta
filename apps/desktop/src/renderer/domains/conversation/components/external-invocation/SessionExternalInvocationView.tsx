import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface ExternalInvocationAgentOption {
	readonly id: string;
	readonly label: string;
}

export interface ExternalInvocationCardModel {
	readonly invocationId: string;
	readonly agentLabel: string;
	readonly prompt: string;
	readonly statusLabel: string;
	readonly exitCode: number | null;
	readonly failureReason: string | null;
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
}

export function SessionExternalInvocationView({
	model,
	penguinTools,
}: {
	readonly model: SessionExternalInvocationModel;
	readonly penguinTools: ReactNode;
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
						<option key={agent.id} value={agent.id}>
							{agent.label}
						</option>
					))}
				</select>
			</label>
			{external ? (
				<>
					{model.showPrompt ? <p>{model.placeholder}</p> : null}
					<p>{model.permissionNote}</p>
					{model.showPrompt ? (
						<textarea aria-label={t("externalInvocation.message")} value={model.prompt} onChange={(event) => model.onPromptChange(event.target.value)} />
					) : null}
					<button type="button" onClick={model.onSend}>
						{model.sendLabel}
					</button>
				</>
			) : (
				penguinTools
			)}
			{model.cards.map((card) => (
				<article key={card.invocationId} aria-label={`${card.agentLabel} ${card.prompt}`}>
					<p>{card.prompt}</p>
					<p>{card.statusLabel}</p>
					{card.exitCode !== null ? <p>{t("externalInvocation.exitCode", { code: card.exitCode })}</p> : null}
					{card.failureReason ? <p>{card.failureReason}</p> : null}
				</article>
			))}
		</section>
	);
}
