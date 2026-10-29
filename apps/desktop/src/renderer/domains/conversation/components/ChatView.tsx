import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
	activeInputDraftKeyAtom,
	bottomPanelStateAtomFamily,
	dispatchBottomPanelAtomFamily,
	pageHeaderLeftSlotAtom,
	pageHeaderRightSlotAtom,
} from "@shared/store/atoms";
import { externalHistoryResumeFor } from "@shared/store/external-history-resume";
import {
	externalRecipientFor,
	externalRecipientVersion,
	subscribeExternalRecipient,
} from "@shared/store/external-recipient";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { useWindowPinAction } from "../hooks/useWindowPinAction";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { ChatHeaderActions } from "@vetta-org/theme-ui/chat";
import { sessionMemoryElements } from "./memory/sessionMemoryElements";
import { MemoryReviewStartProvider, useMemoryReviewModel } from "./memory/useMemoryReviewModel";
import { BackgroundTasksBadge } from "./BackgroundTasksBadge";
import { SandboxGrantsBadge } from "./SandboxGrantsBadge";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView, ChatComposer } from "./chat-view/DefaultChatView";
import { SessionConversation } from "../session-conversation/SessionConversation";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import { SessionExternalInvocationPage } from "./external-invocation/SessionExternalInvocationPage";
import type { ChatViewProps } from "./chat-view/types";

const SessionFeed = memo(SessionConversation);

export const DefaultChatComposer = memo(function DefaultChatComposer({
	onSend,
	onAbort,
	onSendQueued,
	cwdOverride,
	workSurface,
}: ChatViewProps & { readonly workSurface?: WorkSurfaceScope | null }): JSX.Element {
	return (
		<ChatComposer>
			<DefaultInputBarConnector
				contentWidth="message"
				onSend={onSend}
				onAbort={onAbort}
				onSendQueued={onSendQueued}
				cwdOverride={cwdOverride}
				workSurface={workSurface}
			/>
		</ChatComposer>
	);
});

export function ChatView(props: ChatViewProps): JSX.Element {
	const { t } = useTranslation("chat");
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const runtimeIds = useActiveSessionRuntimeIds();
	const pin = useWindowPinAction();
	const terminal = useOpenTerminal(model.workSurface);
	const bottomPanel = useBottomPanelToggle(model.workSurface);
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const scopeKey = model.workSurface?.key ?? "bottom-panel:unbound";
	const dispatchBottomPanel = useSetAtom(dispatchBottomPanelAtomFamily(scopeKey));
	const panel = useAtomValue(bottomPanelStateAtomFamily(scopeKey));
	const draftKey = useAtomValue(activeInputDraftKeyAtom);
	const recipientVersion = useSyncExternalStore(subscribeExternalRecipient, externalRecipientVersion, () => 0);
	const recipient = recipientVersion >= 0 ? externalRecipientFor(draftKey) : "penguin";
	const surface = panel.filled ? "external-terminal" : "conversation";
	const workspace = useMemo(
		() =>
			createActivityWorkspace(
				model.cwd ?? model.sessionId ?? "conversation:unbound",
				model.cwd,
				runtimeIds,
			),
		[model.cwd, model.sessionId, runtimeIds],
	);
	const memory = useMemoryReviewModel(runtimeIds[0] ?? null, window.vetta?.memory ?? null);
	// 菜单只跟文案和开始动作走。改草稿时不要换掉标题栏插槽。
	const memoryMenu = useMemo(
		() => sessionMemoryElements(memory).menu,
		[memory.actions.start, memory.labels.generate, memory.labels.menu],
	);
	const headerActions = useMemo(
		() => (
			<>
				<BackgroundTasksBadge runtimeIds={runtimeIds} activityWorkspaceId={workspace.id} />
				<SandboxGrantsBadge runtimeIds={runtimeIds} />
				<ChatHeaderActions.Export
					title={model.header.exportTitle}
					disabled={model.header.exportDisabled}
					exporting={model.header.exporting}
					onClick={actions.openExport}
				/>
				<ChatHeaderActions.Pin
					title={pin.pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned")}
					pinned={pin.pinned}
					onClick={pin.toggle}
				/>
				<ChatHeaderActions.Terminal
					title={
						!terminal.available
							? t("chatView.terminalButton.unavailable")
							: terminal.focused
								? t("chatView.terminalButton.focused")
								: t("chatView.terminalButton.open")
					}
					focused={terminal.focused}
					disabled={!terminal.available}
					onClick={terminal.open}
				/>
				<ChatHeaderActions.BottomPanel
					title={
						bottomPanel.open
							? t("chatView.bottomPanelButton.open")
							: t("chatView.bottomPanelButton.closed")
					}
					open={bottomPanel.open}
					onClick={bottomPanel.toggle}
				/>
				<ChatHeaderActions.Panel
					title={model.header.panelTitle}
					open={model.header.panelOpen}
					onClick={actions.togglePanel}
				/>
				{surface === "conversation" ? memoryMenu : null}
			</>
		),
		[actions, bottomPanel, memoryMenu, model.header, pin, runtimeIds, surface, t, terminal, workspace.id],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	useEffect(() => {
		setHeaderLeftSlot(
			<>
				<ChatHeaderNewSessionButton />
				{surface === "external-terminal" ? (
					<SessionExternalInvocationPage
						session={
							model.sessionId && model.cwd
								? { sessionId: model.sessionId, cwd: model.cwd }
								: null
						}
						client={window.vetta?.externalInvocations ?? null}
						prompt=""
						onPromptChange={() => undefined}
						showPrompt={false}
						switcherOnly
						penguinTools={null}
						draftKey={draftKey}
						remote={Boolean(model.cwd && isSshProjectUri(model.cwd))}
					/>
				) : null}
			</>,
		);
		return () => setHeaderLeftSlot(null);
	}, [draftKey, model.cwd, model.sessionId, setHeaderLeftSlot, surface]);

	const externalSurface = useRef({ recipient: "penguin", scopeKey: "" });
	useEffect(() => {
		const previous = externalSurface.current;
		if (previous.recipient === recipient && previous.scopeKey === scopeKey) return;
		const recipientChanged = previous.recipient !== recipient;
		// 首屏 scope 还是空的，不算换了面板。真正换主键时要在新面板上再铺一次。
		const scopeChanged = previous.scopeKey !== "" && previous.scopeKey !== scopeKey;
		externalSurface.current = { recipient, scopeKey };
		if (recipient !== "penguin" && (recipientChanged || scopeChanged)) {
			// 续跑要人在输入栏里看到胶囊再发一条。这时铺满终端会把输入栏卸掉，点击就像没反应。
			dispatchBottomPanel({
				type: "set-filled",
				filled: externalHistoryResumeFor(draftKey) === null,
			});
			return;
		}
		if (recipientChanged && recipient === "penguin") {
			dispatchBottomPanel({ type: "set-filled", filled: false });
		}
	}, [dispatchBottomPanel, draftKey, recipient, scopeKey]);

	return (
		<DefaultChatView
			messages={model.messages}
			workspace={workspace}
			workSurface={model.workSurface}
			rootClassName={model.rootClassName}
			exportState={
				model.exporting
					? { title: model.exportTitle, participants, onFinished: actions.finishExport }
					: undefined
			}
			surface={surface}
		>
			{surface === "conversation" ? (
				<MemoryReviewStartProvider start={memory.actions.start}>
					<SessionFeed
						workspace={workspace}
						pendingLabel={model.pendingLabel}
						sessionId={model.sessionId}
						participants={participants}
						onSend={props.onSend}
						onAbort={onAbort}
					/>
					{sessionMemoryElements(memory).panel}
					<DefaultChatComposer {...props} workSurface={model.workSurface} />
				</MemoryReviewStartProvider>
			) : null}
		</DefaultChatView>
	);
}
