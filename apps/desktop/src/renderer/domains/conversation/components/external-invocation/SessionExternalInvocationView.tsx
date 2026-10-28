import { ExternalAgentMark } from "@shared/components/external-agent-mark/ExternalAgentMark";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useToolbarRecipientElement } from "../input-bar/InputBarToolbarActions";

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
	readonly agentId: string;
	readonly agentLabel: string;
	readonly prompt: string;
	readonly statusLabel: string;
	readonly exitCode: number | null;
	readonly failureReason: string | null;
	readonly ordinal: number;
	readonly queued: boolean;
	readonly live: boolean;
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
	readonly switcherOnly: boolean;
	readonly hideComposer: boolean;
	readonly onSend: () => void;
	readonly cards: readonly ExternalInvocationCardModel[];
	readonly onViewInTerminal?: (invocationId: string) => void;
	readonly images: readonly ExternalInvocationImage[];
	readonly onRemoveImage: (path: string) => void;
	readonly imageRejectedLabel: string;
	readonly remoteNote: string | null;
	readonly sendBlocked: boolean;
	readonly newSession: boolean;
	readonly canStartNewSession: boolean;
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
	const compact = !model.showPrompt || model.switcherOnly;
	const selected = model.agents.find((agent) => agent.id === model.recipientId);
	const selectedLabel = selected?.label ?? model.recipientId;
	const recipientSlot = useToolbarRecipientElement();
	// 发给谁和权限一样，是这一轮交给谁。输入栏里把它放到左侧权限后面。
	// 输入栏里的发送始终用右侧那颗圆形按钮，这里不再另画一颗「发给 XXX」。
	const recipientControl = (
		<div className="flex min-w-0 shrink items-center gap-1.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={t("externalInvocation.switcher")}
						title={external ? model.permissionNote : undefined}
						className="no-drag flex h-7 min-w-0 max-w-[14rem] items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-accent/60 data-[state=open]:bg-accent"
					>
						<span className="shrink-0 text-muted-foreground">{t("externalInvocation.switcher")}</span>
						<ExternalAgentMark agentId={model.recipientId} />
						<span className="min-w-0 truncate">{selectedLabel}</span>
						<span className="icon-[solar--alt-arrow-down-linear] size-3 shrink-0 text-muted-foreground" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" side="top" className="min-w-[11rem]">
					{model.agents.map((agent) => {
						const current = agent.id === model.recipientId;
						return (
							<DropdownMenuItem
								key={agent.id}
								disabled={agent.disabled}
								onSelect={() => model.onRecipientChange(agent.id)}
								className={cn("gap-2", current && "bg-accent text-accent-foreground")}
							>
								<ExternalAgentMark agentId={agent.id} />
								<span className="min-w-0 flex-1 truncate">{agent.label}</span>
								{current ? (
									<span className="icon-[solar--check-circle-linear] size-3.5 shrink-0" />
								) : null}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
			{model.remoteNote ? (
				<p className={compact ? "m-0 text-[11px] text-muted-foreground" : undefined}>{model.remoteNote}</p>
			) : null}
		</div>
	);
	const recipient = recipientSlot ? createPortal(recipientControl, recipientSlot) : recipientControl;
	const sharesRoundSendButton = recipientSlot !== null && compact;
	// 紧凑态把下拉框挪到左侧锚点后，这一节不再占右侧的盒子，避免空盒子把模型挤到下一行。
	const sectionClass =
		recipientSlot && compact
			? "contents"
			: compact
				? "flex min-w-0 items-center gap-1.5"
				: undefined;

	if (model.switcherOnly) {
		return (
			<section aria-label={model.sendLabel} className={sectionClass}>
				{recipient}
			</section>
		);
	}

	return (
		<section aria-label={model.sendLabel} className={sectionClass}>
			{recipient}
			{external ? null : (skills ?? null)}
			{external ? (
				<>
					{model.showPrompt && !model.hideComposer ? <p>{model.placeholder}</p> : null}
					{model.showPrompt && !model.hideComposer ? <p>{model.permissionNote}</p> : null}
					{model.historyResume ? (
						<p className={compact ? "m-0 flex max-w-[16rem] shrink-0 items-center gap-1 text-[11px] text-muted-foreground" : undefined}>
							<span className={compact ? "min-w-0 truncate" : undefined}>{t("externalInvocation.resume.capsule", { title: model.historyResume.title })}</span>
							{model.historyResume.directoryNote ? <span>{model.historyResume.directoryNote}</span> : null}
							<Button type="button" variant="ghost" size="sm" onClick={model.onDismissResume}>
								{t("externalInvocation.resume.dismiss")}
							</Button>
						</p>
					) : null}
					{model.images.length > 0 ? (
						<ul className={compact ? "m-0 flex list-none items-center gap-1 p-0" : undefined}>
							{model.images.map((image) => (
								<li key={image.path} className={compact ? "flex items-center gap-1 text-[11px] text-muted-foreground" : undefined}>
									<span>{image.name}</span>
									<span>{model.imageRejectedLabel}</span>
									<Button type="button" variant="ghost" size="sm" onClick={() => model.onRemoveImage(image.path)}>
										{t("inputBar.capsule.removeImage")}
									</Button>
								</li>
							))}
						</ul>
					) : null}
					{model.showPrompt && !model.hideComposer ? (
						<textarea aria-label={t("externalInvocation.message")} value={model.prompt} onChange={(event) => model.onPromptChange(event.target.value)} />
					) : null}
					{model.canStartNewSession ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 shrink-0 px-2.5 text-[12px]"
							aria-pressed={model.newSession}
							onClick={model.onNewSession}
						>
							{t("externalInvocation.newSession")}
						</Button>
					) : null}
					{model.hideComposer ? (
						<p className={compact ? "m-0 text-[11px] text-muted-foreground" : undefined}>
							{t("externalInvocation.continueInTerminal")}
						</p>
					) : sharesRoundSendButton ? null : (
						<Button
							type="button"
							variant="primary"
							size="sm"
							className="h-8 shrink-0 px-2.5 text-[12px]"
							disabled={model.sendBlocked}
							onClick={model.onSend}
						>
							{model.sendLabel}
						</Button>
					)}
				</>
			) : (
				penguinTools
			)}
			{model.showPrompt
				? model.cards.map((card) => (
						<article key={card.invocationId} aria-label={`${card.agentLabel} ${card.prompt}`}>
							<p>{card.prompt}</p>
							<p>{t("externalInvocation.ordinal", { n: card.ordinal })}</p>
							<p>{card.statusLabel}</p>
							{card.queued ? (
								<Button type="button" variant="ghost" size="sm" onClick={() => model.onCancel(card.invocationId)}>
									{t("externalInvocation.cancel")}
								</Button>
							) : null}
							{card.exitCode !== null ? <p>{t("externalInvocation.exitCode", { code: card.exitCode })}</p> : null}
							{card.failureReason ? <p>{card.failureReason}</p> : null}
							{model.onViewInTerminal ? (
								<Button type="button" variant="ghost" size="sm" onClick={() => model.onViewInTerminal?.(card.invocationId)}>
									{t("externalInvocation.viewInTerminal")}
								</Button>
							) : null}
						</article>
					))
				: null}
		</section>
	);
}
